/**
 * The ergonomic HeirVault client.
 *
 * Reads are simulated against Soroban RPC and decoded into domain types. Writes
 * run the full lifecycle in `transaction.ts` and only resolve when the ledger
 * confirms the transaction.
 *
 * ## Partial-failure safety
 *
 * The contract is a set of independent transactions; nothing here is atomic.
 * {@link HeirVaultClient.createVaultWithSetup} therefore returns the created
 * vault id as soon as `create_vault` confirms, plus the exact list of follow-up
 * steps that did **not** complete — so a caller can resume without duplicating
 * a deposit or re-adding a beneficiary.
 */

import { rpc } from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";

import { bindings, type HeirVaultMethod } from "./bindings.js";
import { parseVaultId } from "./codec.js";
import { InvalidArgumentError, SignerNotConfiguredError } from "./errors.js";
import { resolveNetwork, type NetworkConfig, type NetworkConfigInput } from "./network.js";
import type { WalletSigner } from "./signer.js";
import {
  READ_ONLY_SOURCE,
  simulateRead,
  submitInvocation,
  type TransactionPhase,
  type TxSuccess,
} from "./transaction.js";
import {
  MAX_PAGE_LIMIT,
  type ActivationMode,
  type Beneficiary,
  type BeneficiaryPage,
  type BeneficiaryVaultPage,
  type ClaimPage,
  type ClaimRecord,
  type CreateVaultArgs,
  type Deadlines,
  type GuardianPage,
  type GuardianStatus,
  type StellarAddress,
  type TokenAmount,
  type Vault,
  type VaultId,
  type VaultPage,
  type VaultStatus,
} from "./types.js";

/** A vault id in any of the forms a UI naturally holds. */
export type VaultIdInput = string | number | bigint;

/** Metadata for the asset a deployment distributes. */
export interface AssetInfo {
  /** SEP-41 contract id of the asset. */
  contractId?: string;
  symbol?: string;
  decimals: number;
}

export interface HeirVaultClientConfig {
  /** Deployed HeirVault contract id (`C…`). */
  contractId: string;
  /** A known network id or a partial config overriding the defaults. */
  network?: NetworkConfigInput;
  /** Wallet signer used for writes. Optional for read-only clients. */
  signer?: WalletSigner;
  /** Address used as the simulated source for reads (defaults to a fixed one). */
  readSourceAddress?: string;
  /** Inject an RPC server (used in tests to avoid network access). */
  server?: rpc.Server;
  /** Asset metadata used to resolve `deposit`'s asset argument. */
  asset?: AssetInfo;
  /** Page size used by the list helpers. Clamped to `MAX_PAGE_LIMIT`. */
  defaultPageLimit?: number;
}

export interface ReadOptions {
  /** Override the simulated source account. */
  sourceAddress?: string;
  offset?: number;
  limit?: number;
}

export interface WriteOptions {
  /** Fee-paying source account. Defaults to the address the contract authorises. */
  sourceAddress?: string;
  onPhase?: (phase: TransactionPhase) => void;
  pollAttempts?: number;
  pollIntervalMs?: number;
  timeoutSeconds?: number;
}

export interface DepositOptions extends WriteOptions {
  /** Override the asset contract id (defaults to `config.asset.contractId`). */
  assetContractId?: string;
}

/** One follow-up step in {@link HeirVaultClient.createVaultWithSetup}. */
export type VaultSetupStep =
  | { type: "addBeneficiary"; beneficiary: StellarAddress; allocationBps: number }
  | { type: "addGuardian"; guardian: StellarAddress }
  | { type: "setGuardianThreshold"; threshold: number }
  | { type: "deposit"; amount: TokenAmount; assetContractId?: string };

/** Result of one follow-up setup step. */
export interface VaultSetupStepResult {
  step: VaultSetupStep;
  ok: boolean;
  hash?: string;
  ledger?: number;
  error?: string;
}

/** Outcome of a vault-creation workflow, safe to resume from a failure. */
export interface VaultCreationResult {
  vaultId: VaultId;
  createHash: string;
  createLedger?: number;
  /** Every step that was attempted, in order, with its outcome. */
  steps: VaultSetupStepResult[];
  /** `true` when every requested step completed. */
  completed: boolean;
  /** Steps that did not complete, in order, for a safe retry. */
  remaining: VaultSetupStep[];
}

/** Typed, ergonomic access to a deployed HeirVault contract. */
export class HeirVaultClient {
  readonly contractId: string;
  readonly network: NetworkConfig;
  readonly asset?: AssetInfo;
  /** Page size for list helpers. */
  readonly defaultPageLimit: number;

  private signer?: WalletSigner;
  private server: rpc.Server;
  private readSource: string;

  constructor(config: HeirVaultClientConfig) {
    if (!config.contractId || config.contractId.trim() === "") {
      throw new InvalidArgumentError("A HeirVault contract id is required.");
    }
    this.contractId = config.contractId.trim();
    this.network = resolveNetwork(config.network);
    this.signer = config.signer;
    this.asset = config.asset;
    this.readSource = config.readSourceAddress ?? READ_ONLY_SOURCE;
    this.defaultPageLimit = clampLimit(config.defaultPageLimit ?? MAX_PAGE_LIMIT);
    this.server = config.server ?? createRpcServer(this.network);
  }

  /** Replace the wallet signer (for example after the user connects a wallet). */
  setSigner(signer: WalletSigner | undefined): void {
    this.signer = signer;
  }

  /** Replace the read source account. */
  setReadSource(address: string): void {
    this.readSource = address;
  }

  /** Replace the RPC server (used by tests and for failover). */
  setServer(server: rpc.Server): void {
    this.server = server;
  }

  /** The underlying RPC server. */
  getServer(): rpc.Server {
    return this.server;
  }

  private requireSigner(): WalletSigner {
    if (!this.signer) {
      throw new SignerNotConfiguredError(
        "This operation requires a wallet signer. Pass `signer` to the client or call `setSigner`.",
      );
    }
    return this.signer;
  }

  private assetContractId(override?: string): string {
    const id = override ?? this.asset?.contractId;
    if (!id) {
      throw new InvalidArgumentError(
        "No asset contract id is available. Configure `asset.contractId` or pass `assetContractId`.",
      );
    }
    return id;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  private async read<In, Out>(
    binding: { method: HeirVaultMethod; encode: (input: In) => xdr.ScVal[]; decode: (native: unknown) => Out },
    input: In,
    options: ReadOptions = {},
  ): Promise<Out> {
    const native = await simulateRead({
      server: this.server,
      networkPassphrase: this.network.passphrase,
      contractId: this.contractId,
      method: binding.method,
      args: binding.encode(input),
      ...(options.sourceAddress ?? this.readSource
        ? { sourceAddress: options.sourceAddress ?? this.readSource }
        : {}),
    });
    return binding.decode(native);
  }

  /** Full vault detail plus the contract's derived fields. */
  async getVault(vaultId: VaultIdInput, options?: ReadOptions): Promise<Vault> {
    return this.read(bindings.getVault, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** The clock-adjusted lifecycle status. */
  async getVaultStatus(vaultId: VaultIdInput, options?: ReadOptions): Promise<VaultStatus> {
    return this.read(bindings.getVaultStatus, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** Deadline, grace end and the current ledger timestamp. */
  async getDeadlines(vaultId: VaultIdInput, options?: ReadOptions): Promise<Deadlines> {
    return this.read(bindings.getDeadlines, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** `true` when the vault's beneficiaries can claim right now. */
  async isClaimable(vaultId: VaultIdInput, options?: ReadOptions): Promise<boolean> {
    return this.read(bindings.isClaimable, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** One page of an owner's vaults. */
  async getVaultsByOwner(owner: StellarAddress, options: ReadOptions = {}): Promise<VaultPage> {
    return this.read(
      bindings.getVaultsByOwner,
      { owner, offset: options.offset ?? 0, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
      options,
    );
  }

  /** Every vault an owner has created, following the paging cursor. */
  getAllVaultsByOwner(owner: StellarAddress, options: ReadOptions = {}): Promise<VaultPage["items"]> {
    return collectPages((offset) =>
      this.read(
        bindings.getVaultsByOwner,
        { owner, offset, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
        options,
      ),
    );
  }

  /** One page of vault ids in which a beneficiary is enrolled. */
  async getVaultsByBeneficiary(beneficiary: StellarAddress, options: ReadOptions = {}): Promise<BeneficiaryVaultPage> {
    return this.read(
      bindings.getVaultsByBeneficiary,
      { beneficiary, offset: options.offset ?? 0, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
      options,
    );
  }

  /** Total number of vaults ever created. */
  async getVaultCount(options?: ReadOptions): Promise<VaultId> {
    return this.read(bindings.getVaultCount, undefined, options);
  }

  /** The schema version of the running contract code. */
  async schemaVersion(options?: ReadOptions): Promise<number> {
    return this.read(bindings.schemaVersion, undefined, options);
  }

  /** One page of beneficiary slots (includes deactivated slots). */
  async getBeneficiaries(vaultId: VaultIdInput, options: ReadOptions = {}): Promise<BeneficiaryPage> {
    return this.read(
      bindings.getBeneficiaries,
      { vaultId: parseVaultId(vaultId), offset: options.offset ?? 0, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
      options,
    );
  }

  /** Every active beneficiary, unpaged. */
  async getActiveBeneficiaries(vaultId: VaultIdInput, options?: ReadOptions): Promise<Beneficiary[]> {
    return this.read(bindings.getActiveBeneficiaries, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** Sum of active allocations, in basis points. */
  async getTotalAllocation(vaultId: VaultIdInput, options?: ReadOptions): Promise<number> {
    return this.read(bindings.getTotalAllocation, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** One page of guardian slots (includes deactivated slots). */
  async getGuardians(vaultId: VaultIdInput, options: ReadOptions = {}): Promise<GuardianPage> {
    return this.read(
      bindings.getGuardians,
      { vaultId: parseVaultId(vaultId), offset: options.offset ?? 0, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
      options,
    );
  }

  /** Approvals recorded, threshold required, and whether the threshold is met. */
  async getGuardianStatus(vaultId: VaultIdInput, options?: ReadOptions): Promise<GuardianStatus> {
    return this.read(bindings.getGuardianStatus, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** One page of claim positions. */
  async getClaims(vaultId: VaultIdInput, options: ReadOptions = {}): Promise<ClaimPage> {
    return this.read(
      bindings.getClaims,
      { vaultId: parseVaultId(vaultId), offset: options.offset ?? 0, limit: clampLimit(options.limit ?? this.defaultPageLimit) },
      options,
    );
  }

  /** The claim position of one beneficiary. */
  async getClaim(vaultId: VaultIdInput, beneficiary: StellarAddress, options?: ReadOptions): Promise<ClaimRecord> {
    return this.read(bindings.getClaim, { vaultId: parseVaultId(vaultId), beneficiary }, options);
  }

  /** Amount on an activated vault that no heir has claimed yet. */
  async getUndistributedBalance(vaultId: VaultIdInput, options?: ReadOptions): Promise<TokenAmount> {
    return this.read(bindings.getUndistributedBalance, { vaultId: parseVaultId(vaultId) }, options);
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  private async write<In, Out>(
    binding: { method: HeirVaultMethod; encode: (input: In) => xdr.ScVal[]; decode: (native: unknown) => Out },
    input: In,
    options: WriteOptions,
    /** Address that must authorise this call, when the contract knows it. */
    defaultSource?: string,
  ): Promise<TxSuccess<Out>> {
    const signer = this.requireSigner();
    const sourceAddress = options.sourceAddress ?? defaultSource ?? (await signer.getAddress());
    return submitInvocation<Out>({
      server: this.server,
      networkPassphrase: this.network.passphrase,
      contractId: this.contractId,
      method: binding.method,
      args: binding.encode(input),
      signer,
      sourceAddress,
      decode: binding.decode,
      timeoutSeconds: options.timeoutSeconds,
      pollAttempts: options.pollAttempts,
      pollIntervalMs: options.pollIntervalMs,
      onPhase: options.onPhase,
    });
  }

  /** Create an empty vault; returns the new vault id from the ledger. */
  async createVault(args: CreateVaultArgs, options: WriteOptions = {}): Promise<TxSuccess<VaultId>> {
    return this.write(bindings.createVault, args, options, args.owner);
  }

  /**
   * Deposit into a vault.
   *
   * `asset` must equal the vault's configured asset; the contract rejects a
   * mismatch before attempting any transfer.
   */
  async deposit(vaultId: VaultIdInput, amount: TokenAmount, options: DepositOptions = {}): Promise<TxSuccess<void>> {
    const asset = this.assetContractId(options.assetContractId);
    return this.write(bindings.deposit, { vaultId: parseVaultId(vaultId), asset, amount }, options);
  }

  /** Add a beneficiary with an allocation in basis points. */
  async addBeneficiary(
    vaultId: VaultIdInput,
    beneficiary: StellarAddress,
    allocationBps: number,
    options: WriteOptions = {},
  ): Promise<TxSuccess<void>> {
    return this.write(
      bindings.addBeneficiary,
      { vaultId: parseVaultId(vaultId), beneficiary, allocationBps },
      options,
    );
  }

  /** Deactivate a beneficiary and release its allocation. */
  async removeBeneficiary(vaultId: VaultIdInput, beneficiary: StellarAddress, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.removeBeneficiary, { vaultId: parseVaultId(vaultId), beneficiary }, options);
  }

  /** Change an active beneficiary's allocation. */
  async updateBeneficiary(
    vaultId: VaultIdInput,
    beneficiary: StellarAddress,
    newAllocationBps: number,
    options: WriteOptions = {},
  ): Promise<TxSuccess<void>> {
    return this.write(
      bindings.updateBeneficiary,
      { vaultId: parseVaultId(vaultId), beneficiary, newAllocationBps },
      options,
    );
  }

  /** Add a guardian (threshold defaults to 1 on the first guardian). */
  async addGuardian(vaultId: VaultIdInput, guardian: StellarAddress, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.addGuardian, { vaultId: parseVaultId(vaultId), guardian }, options);
  }

  /** Remove a guardian. */
  async removeGuardian(vaultId: VaultIdInput, guardian: StellarAddress, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.removeGuardian, { vaultId: parseVaultId(vaultId), guardian }, options);
  }

  /** Set the guardian approval threshold. */
  async setGuardianThreshold(vaultId: VaultIdInput, threshold: number, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.setGuardianThreshold, { vaultId: parseVaultId(vaultId), threshold }, options);
  }

  /** Record the guardian's approval of the current activation attempt. */
  async guardianApprove(vaultId: VaultIdInput, guardian: StellarAddress, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.guardianApprove, { vaultId: parseVaultId(vaultId), guardian }, options, guardian);
  }

  /** Prove the owner is active; returns the new deadline (seconds). */
  async checkIn(vaultId: VaultIdInput, options: WriteOptions = {}): Promise<TxSuccess<VaultId>> {
    return this.write(bindings.checkIn, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** Permissionless release once the activation conditions hold. */
  async activateVault(vaultId: VaultIdInput, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.activateVault, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** Cancel the vault (owner only; moves no funds). */
  async cancelVault(vaultId: VaultIdInput, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.cancelVault, { vaultId: parseVaultId(vaultId) }, options);
  }

  /** Withdraw from a cancelled vault back to the owner. */
  async withdraw(vaultId: VaultIdInput, amount: TokenAmount, options: WriteOptions = {}): Promise<TxSuccess<void>> {
    return this.write(bindings.withdraw, { vaultId: parseVaultId(vaultId), amount }, options);
  }

  /** Claim the calling beneficiary's allocation; returns the amount paid. */
  async claim(vaultId: VaultIdInput, beneficiary: StellarAddress, options: WriteOptions = {}): Promise<TxSuccess<TokenAmount>> {
    return this.write(bindings.claim, { vaultId: parseVaultId(vaultId), beneficiary }, options, beneficiary);
  }

  // -------------------------------------------------------------------------
  // Multi-step workflow
  // -------------------------------------------------------------------------

  /**
   * Create a vault and then run a list of setup steps, each as its own
   * transaction.
   *
   * The returned {@link VaultCreationResult} carries the created id as soon as
   * `create_vault` confirms, the outcome of every attempted step, and the exact
   * `remaining` steps if one failed — so the caller can resume without
   * duplicating a deposit or a beneficiary.
   *
   * Only a failure of `create_vault` itself throws; a failed follow-up step is
   * reported in `steps`, never as a success.
   */
  async createVaultWithSetup(
    args: CreateVaultArgs,
    steps: VaultSetupStep[] = [],
    options: WriteOptions = {},
  ): Promise<VaultCreationResult> {
    const created = await this.createVault(args, options);
    const vaultId = created.value;

    const results: VaultSetupStepResult[] = [];
    let failedAt = steps.length;

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]!;
      try {
        const outcome = await this.runSetupStep(vaultId, step, options);
        results.push({ step, ok: true, hash: outcome.hash, ledger: outcome.ledger });
      } catch (error) {
        results.push({
          step,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failedAt = index;
        break;
      }
    }

    return {
      vaultId,
      createHash: created.hash,
      createLedger: created.ledger,
      steps: results,
      completed: failedAt === steps.length,
      remaining: steps.slice(failedAt),
    };
  }

  private async runSetupStep(
    vaultId: VaultId,
    step: VaultSetupStep,
    options: WriteOptions,
  ): Promise<{ hash: string; ledger?: number }> {
    switch (step.type) {
      case "addBeneficiary": {
        const result = await this.addBeneficiary(vaultId, step.beneficiary, step.allocationBps, options);
        return { hash: result.hash, ledger: result.ledger };
      }
      case "addGuardian": {
        const result = await this.addGuardian(vaultId, step.guardian, options);
        return { hash: result.hash, ledger: result.ledger };
      }
      case "setGuardianThreshold": {
        const result = await this.setGuardianThreshold(vaultId, step.threshold, options);
        return { hash: result.hash, ledger: result.ledger };
      }
      case "deposit": {
        const result = await this.deposit(vaultId, step.amount, {
          ...options,
          ...(step.assetContractId ? { assetContractId: step.assetContractId } : {}),
        });
        return { hash: result.hash, ledger: result.ledger };
      }
    }
  }
}

/** Clamp a requested page size to the contract's supported range. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return MAX_PAGE_LIMIT;
  return Math.min(Math.floor(limit), MAX_PAGE_LIMIT);
}

/** Follow a page's `nextOffset` cursor until `hasMore` is false. */
async function collectPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; meta: { hasMore: boolean; nextOffset: number | null } }>,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  // A hard cap protects against a contract bug that never reports the last page.
  for (let page = 0; page < 100; page += 1) {
    const result = await fetchPage(offset);
    items.push(...result.items);
    if (!result.meta.hasMore || result.meta.nextOffset === null) break;
    offset = result.meta.nextOffset;
  }
  return items;
}

/** Build the RPC server for a network config. */
export function createRpcServer(network: NetworkConfig): rpc.Server {
  return new rpc.Server(network.rpcUrl, { allowHttp: network.rpcUrl.startsWith("http://") });
}

/** Convenience constructor. */
export function createClient(config: HeirVaultClientConfig): HeirVaultClient {
  return new HeirVaultClient(config);
}

export type { ActivationMode };
