/**
 * HeirVault Autonomous Keeper Service.
 *
 * Maintains on-chain persistent storage TTLs for HeirVault inheritance vaults.
 *
 * Stellar Soroban persistent storage entries have a hard network maximum TTL of
 * ~90 to 120 days (`PERSISTENT_TTL_EXTEND_TO = 1,555,200` ledgers).
 * Vaults configured with multi-month or multi-year check-in periods (up to 5 years)
 * will decay and eventually be archived if left completely untouched.
 *
 * This keeper runs autonomous maintenance cycles:
 * - Inspects vault lifecycle state (Active, GracePeriod, Activated, Completed, Cancelled);
 * - Skips settled vaults (Completed / Cancelled) idempotently;
 * - Submits on-chain `pingVault` transactions for active vaults needing renewal;
 * - Checks archival status and flags vaults requiring `restoreFootprint`;
 * - Verifies keeper account balance and emits alerts before running out of transaction fees;
 * - Provides structured JSON logging and configurable retry/backoff.
 */

import { Horizon } from "@stellar/stellar-sdk";
import type { HeirVaultClient } from "./client.js";
import { ArchivedStorageError } from "./errors.js";
import type { WalletSigner } from "./signer.js";
import type { Vault, VaultId, VaultStatus } from "./types.js";

export interface KeeperLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface KeeperAlert {
  level: "warn" | "critical";
  type: "low_balance" | "ping_failed" | "vault_archived" | "rpc_error";
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export interface KeeperConfig {
  /** The configured HeirVaultClient instance. */
  client: HeirVaultClient;
  /** Autonomous signer controlling the keeper account. */
  signer?: WalletSigner;
  /** Explicit vault IDs to monitor; if omitted or empty, scans all vaults via `getVaultCount`. */
  vaultIds?: bigint[];
  /** Minimum XLM balance required on the keeper account before alerting (default: 5 XLM). */
  minKeeperBalanceXlm?: number;
  /** Maximum retry attempts for failed RPC calls or transaction submissions (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000ms). */
  retryBackoffMs?: number;
  /** Custom structured logger; defaults to JSON console logger. */
  logger?: KeeperLogger;
  /** Callback for monitoring alerts (webhooks, email, PagerDuty). */
  onAlert?: (alert: KeeperAlert) => void;
}

export interface VaultHealth {
  vaultId: bigint;
  status: VaultStatus | "Archived" | "NotFound" | "Error";
  vault?: Vault;
  needsPing: boolean;
  isArchived: boolean;
  error?: string;
}

export interface PingResult {
  vaultId: bigint;
  status: "success" | "skipped" | "failed" | "archived";
  txHash?: string;
  ledger?: number;
  error?: string;
}

export interface MaintenanceReport {
  timestamp: string;
  keeperAddress: string;
  keeperBalanceXlm: number;
  vaultsScanned: number;
  vaultsPinged: number;
  vaultsSkipped: number;
  vaultsArchived: number;
  vaultsFailed: number;
  results: PingResult[];
  durationMs: number;
}

const defaultLogger: KeeperLogger = {
  info(msg, ctx) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", message: msg, ...ctx }));
  },
  warn(msg, ctx) {
    console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: "WARN", message: msg, ...ctx }));
  },
  error(msg, ctx) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "ERROR", message: msg, ...ctx }));
  },
};

export class HeirVaultKeeper {
  private readonly client: HeirVaultClient;
  private readonly signer?: WalletSigner;
  private readonly monitoredVaultIds?: bigint[];
  private readonly minBalanceXlm: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly logger: KeeperLogger;
  private readonly onAlert?: (alert: KeeperAlert) => void;

  constructor(config: KeeperConfig) {
    this.client = config.client;
    this.signer = config.signer;
    this.monitoredVaultIds = config.vaultIds;
    this.minBalanceXlm = config.minKeeperBalanceXlm ?? 5;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBackoffMs = config.retryBackoffMs ?? 1000;
    this.logger = config.logger ?? defaultLogger;
    this.onAlert = config.onAlert;
  }

  private emitAlert(type: KeeperAlert["type"], level: KeeperAlert["level"], message: string, context?: Record<string, unknown>) {
    const alert: KeeperAlert = {
      level,
      type,
      message,
      context,
      timestamp: new Date().toISOString(),
    };
    if (level === "critical") {
      this.logger.error(`[ALERT] ${message}`, context);
    } else {
      this.logger.warn(`[ALERT] ${message}`, context);
    }
    this.onAlert?.(alert);
  }

  /**
   * Check the keeper account's current XLM balance.
   */
  async checkKeeperBalance(): Promise<{ address: string; balanceXlm: number; isSufficient: boolean }> {
    if (!this.signer) {
      return { address: "none", balanceXlm: 0, isSufficient: false };
    }
    const address = await this.signer.getAddress();
    const horizonUrl = this.client.network.horizonUrl;
    let balanceXlm = 0;

    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await server.loadAccount(address);
      const nativeBalance = account.balances.find((b) => b.asset_type === "native");
      balanceXlm = nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    } catch (err) {
      this.logger.warn("Could not query keeper balance via Horizon", {
        address,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const isSufficient = balanceXlm >= this.minBalanceXlm;
    if (!isSufficient) {
      this.emitAlert(
        "low_balance",
        balanceXlm < 1 ? "critical" : "warn",
        `Keeper balance is low (${balanceXlm.toFixed(2)} XLM). Minimum threshold is ${this.minBalanceXlm} XLM.`,
        { address, balanceXlm, threshold: this.minBalanceXlm },
      );
    }

    return { address, balanceXlm, isSufficient };
  }

  /**
   * Inspect the operational health and storage status of a single vault.
   */
  async checkVaultHealth(vaultId: bigint): Promise<VaultHealth> {
    try {
      const archival = await this.client.checkArchivalStatus(vaultId);
      if (archival.isArchived) {
        this.emitAlert(
          "vault_archived",
          "critical",
          `Vault ${vaultId.toString()} storage has expired and is archived! Requires restoreFootprint.`,
          { vaultId: vaultId.toString() },
        );
        return { vaultId, status: "Archived", isArchived: true, needsPing: false };
      }

      const vault = await this.client.getVault(vaultId);
      // Completed and Cancelled vaults have distributed or returned funds; no further keeper pings needed
      const isSettled = vault.status === "Completed" || vault.status === "Cancelled";
      const needsPing = !isSettled;

      return {
        vaultId,
        status: vault.status,
        vault,
        needsPing,
        isArchived: false,
      };
    } catch (error) {
      if (error instanceof ArchivedStorageError) {
        return { vaultId, status: "Archived", isArchived: true, needsPing: false };
      }
      return {
        vaultId,
        status: "Error",
        isArchived: false,
        needsPing: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Ping a single vault with exponential backoff retries.
   */
  async pingVaultWithRetry(vaultId: bigint): Promise<PingResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        this.logger.info(`Pinging vault ${vaultId.toString()} (attempt ${attempt}/${this.maxRetries})...`, {
          vaultId: vaultId.toString(),
          attempt,
        });

        const tx = await this.client.pingVault(vaultId);
        this.logger.info(`✓ Successfully pinged vault ${vaultId.toString()}!`, {
          vaultId: vaultId.toString(),
          hash: tx.hash,
          ledger: tx.ledger,
        });

        return {
          vaultId,
          status: "success",
          txHash: tx.hash,
          ledger: tx.ledger,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Ping attempt ${attempt} failed for vault ${vaultId.toString()}: ${lastError.message}`, {
          vaultId: vaultId.toString(),
          attempt,
          error: lastError.message,
        });

        if (err instanceof ArchivedStorageError) {
          return {
            vaultId,
            status: "archived",
            error: "Vault is archived and cannot be pinged until restored.",
          };
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryBackoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const errorMsg = lastError?.message ?? "Max retries exceeded";
    this.emitAlert("ping_failed", "warn", `Failed to ping vault ${vaultId.toString()} after ${this.maxRetries} attempts`, {
      vaultId: vaultId.toString(),
      error: errorMsg,
    });

    return {
      vaultId,
      status: "failed",
      error: errorMsg,
    };
  }

  /**
   * Run one complete maintenance cycle across all monitored vaults.
   */
  async runMaintenanceCycle(): Promise<MaintenanceReport> {
    const startTime = Date.now();
    this.logger.info("Starting keeper maintenance cycle...");

    const balanceInfo = await this.checkKeeperBalance();
    const results: PingResult[] = [];

    // Discover vault IDs
    let ids: bigint[] = [];
    if (this.monitoredVaultIds && this.monitoredVaultIds.length > 0) {
      ids = this.monitoredVaultIds;
    } else {
      try {
        const total = await this.client.getVaultCount();
        for (let i = 1n; i <= total; i += 1n) {
          ids.push(i);
        }
      } catch (err) {
        this.emitAlert("rpc_error", "critical", "Failed to retrieve total vault count from contract", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          timestamp: new Date().toISOString(),
          keeperAddress: balanceInfo.address,
          keeperBalanceXlm: balanceInfo.balanceXlm,
          vaultsScanned: 0,
          vaultsPinged: 0,
          vaultsSkipped: 0,
          vaultsArchived: 0,
          vaultsFailed: 1,
          results: [],
          durationMs: Date.now() - startTime,
        };
      }
    }

    let pinged = 0;
    let skipped = 0;
    let archived = 0;
    let failed = 0;

    for (const id of ids) {
      const health = await this.checkVaultHealth(id);

      if (health.isArchived) {
        archived += 1;
        results.push({ vaultId: id, status: "archived", error: "Storage is archived" });
        continue;
      }

      if (!health.needsPing) {
        skipped += 1;
        this.logger.info(`Vault ${id.toString()} is settled (${health.status}); skipping ping.`, {
          vaultId: id.toString(),
          status: health.status,
        });
        results.push({ vaultId: id, status: "skipped" });
        continue;
      }

      // Needs maintenance ping
      const res = await this.pingVaultWithRetry(id);
      results.push(res);
      if (res.status === "success") pinged += 1;
      else if (res.status === "archived") archived += 1;
      else if (res.status === "failed") failed += 1;
    }

    const durationMs = Date.now() - startTime;
    const report: MaintenanceReport = {
      timestamp: new Date().toISOString(),
      keeperAddress: balanceInfo.address,
      keeperBalanceXlm: balanceInfo.balanceXlm,
      vaultsScanned: ids.length,
      vaultsPinged: pinged,
      vaultsSkipped: skipped,
      vaultsArchived: archived,
      vaultsFailed: failed,
      results,
      durationMs,
    };

    this.logger.info("Keeper maintenance cycle completed", {
      scanned: ids.length,
      pinged,
      skipped,
      archived,
      failed,
      durationMs,
    });

    return report;
  }

  /**
   * Start a recurring maintenance daemon that fires on a fixed interval.
   *
   * @param intervalSeconds Interval in seconds (e.g. 86400 for daily, 2592000 for monthly).
   */
  startDaemon(intervalSeconds: number): { stop: () => void } {
    let active = true;
    this.logger.info(`Starting keeper daemon with interval ${intervalSeconds}s...`);

    const runLoop = async () => {
      while (active) {
        try {
          await this.runMaintenanceCycle();
        } catch (err) {
          this.logger.error("Unexpected error in keeper cycle loop", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (!active) break;
        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      }
    };

    runLoop().catch((err) => {
      this.logger.error("Daemon fatal error", { error: err instanceof Error ? err.message : String(err) });
    });

    return {
      stop: () => {
        active = false;
        this.logger.info("Keeper daemon stopped.");
      },
    };
  }
}
