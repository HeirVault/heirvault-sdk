import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { HeirVaultClient } from "../src/client.js";
import { HeirVaultKeeper, type KeeperAlert } from "../src/keeper.js";
import { KeypairSigner } from "../src/signer.js";
import type { Vault } from "../src/types.js";
import {
  TEST_CONTRACT,
  fakeServer,
  signingSigner,
} from "./helpers.js";

function createMockVault(overrides: Partial<Vault> = {}): Vault {
  return {
    id: 1n,
    owner: "GDRRN23CGXTC4CBONFVQBCELSEQPBRDW6T7PQXAGWFQFELUGUOUUYCZG",
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    balance: 10000000n,
    status: "Active",
    activationMode: "MissedCheckIn",
    checkInPeriodSeconds: 86400,
    gracePeriodSeconds: 86400,
    lastCheckInSeconds: 1000,
    lastStatusChangeSeconds: 1000,
    activatedAtSeconds: 0,
    distributionBalance: 0n,
    totalClaimed: 0n,
    claimedCount: 0,
    beneficiaries: [],
    guardians: [],
    guardianThreshold: 0,
    guardianApprovals: 0,
    createdAtSeconds: 1000,
    schemaVersion: 1,
    deadlineSeconds: 87400,
    graceEndSeconds: 173800,
    effectiveStatus: "Active",
    totalAllocationBps: 10000,
    activationReady: false,
    lastCheckInAt: new Date(1000 * 1000).toISOString(),
    lastStatusChangeAt: new Date(1000 * 1000).toISOString(),
    activatedAt: null,
    createdAt: new Date(1000 * 1000).toISOString(),
    deadline: new Date(87400 * 1000).toISOString(),
    graceEnd: new Date(173800 * 1000).toISOString(),
    ...overrides,
  };
}

describe("HeirVaultKeeper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with configuration and custom logger", () => {
    const { signer } = signingSigner();
    const fake = fakeServer({ simulations: [] });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      server: fake.server,
      signer,
    });

    const logs: string[] = [];
    const keeper = new HeirVaultKeeper({
      client,
      signer,
      vaultIds: [1n, 2n],
      logger: {
        info: (msg) => logs.push(`INFO: ${msg}`),
        warn: (msg) => logs.push(`WARN: ${msg}`),
        error: (msg) => logs.push(`ERROR: ${msg}`),
      },
    });

    expect(keeper).toBeDefined();
  });

  it("skips settled vaults (Completed / Cancelled) idempotently", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({ simulations: [] });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      server: fake.server,
      signer,
    });

    vi.spyOn(HeirVaultKeeper.prototype, "checkKeeperBalance").mockResolvedValue({
      address: "GDRRN23CGXTC4CBONFVQBCELSEQPBRDW6T7PQXAGWFQFELUGUOUUYCZG",
      balanceXlm: 25,
      isSufficient: true,
    });

    vi.spyOn(client, "checkArchivalStatus").mockResolvedValue({ isArchived: false });
    vi.spyOn(client, "getVault").mockResolvedValue(
      createMockVault({
        id: 1n,
        balance: 0n,
        status: "Completed",
        effectiveStatus: "Completed",
      }),
    );

    const pingSpy = vi.spyOn(client, "pingVault");

    const keeper = new HeirVaultKeeper({
      client,
      signer,
      vaultIds: [1n],
    });

    const report = await keeper.runMaintenanceCycle();
    expect(report.vaultsScanned).toBe(1);
    expect(report.vaultsSkipped).toBe(1);
    expect(report.vaultsPinged).toBe(0);
    expect(pingSpy).not.toHaveBeenCalled();
  });

  it("submits a ping transaction for Active vaults requiring maintenance", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({ simulations: [] });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      server: fake.server,
      signer,
    });

    vi.spyOn(HeirVaultKeeper.prototype, "checkKeeperBalance").mockResolvedValue({
      address: "GDRRN23CGXTC4CBONFVQBCELSEQPBRDW6T7PQXAGWFQFELUGUOUUYCZG",
      balanceXlm: 25,
      isSufficient: true,
    });

    const vault2 = createMockVault({
      id: 2n,
      balance: 10000000n,
      status: "Active",
    });

    vi.spyOn(client, "checkArchivalStatus").mockResolvedValue({ isArchived: false });
    vi.spyOn(client, "getVault").mockResolvedValue(vault2);

    const pingSpy = vi.spyOn(client, "pingVault").mockResolvedValue({
      status: "success",
      hash: "11".repeat(32),
      ledger: 105,
      value: vault2,
    });

    const keeper = new HeirVaultKeeper({
      client,
      signer,
      vaultIds: [2n],
    });

    const report = await keeper.runMaintenanceCycle();
    expect(report.vaultsScanned).toBe(1);
    expect(report.vaultsPinged).toBe(1);
    expect(report.results[0]?.status).toBe("success");
    expect(report.results[0]?.txHash).toBe("11".repeat(32));
    expect(pingSpy).toHaveBeenCalledWith(2n);
  });

  it("detects archived vaults and emits a critical alert", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({ simulations: [] });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      server: fake.server,
      signer,
    });

    vi.spyOn(HeirVaultKeeper.prototype, "checkKeeperBalance").mockResolvedValue({
      address: "GDRRN23CGXTC4CBONFVQBCELSEQPBRDW6T7PQXAGWFQFELUGUOUUYCZG",
      balanceXlm: 25,
      isSufficient: true,
    });

    vi.spyOn(client, "checkArchivalStatus").mockResolvedValue({
      isArchived: true,
      minResourceFee: "5000",
      restorePreamble: {} as any,
    });

    const alerts: KeeperAlert[] = [];
    const keeper = new HeirVaultKeeper({
      client,
      signer,
      vaultIds: [3n],
      onAlert: (alert) => alerts.push(alert),
    });

    const report = await keeper.runMaintenanceCycle();
    expect(report.vaultsScanned).toBe(1);
    expect(report.vaultsArchived).toBe(1);
    expect(report.vaultsPinged).toBe(0);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]?.type).toBe("vault_archived");
    expect(alerts[0]?.level).toBe("critical");
  });

  it("retries failed pings with backoff before reporting failure", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({ simulations: [] });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      server: fake.server,
      signer,
    });

    vi.spyOn(HeirVaultKeeper.prototype, "checkKeeperBalance").mockResolvedValue({
      address: "GDRRN23CGXTC4CBONFVQBCELSEQPBRDW6T7PQXAGWFQFELUGUOUUYCZG",
      balanceXlm: 25,
      isSufficient: true,
    });

    vi.spyOn(client, "checkArchivalStatus").mockResolvedValue({ isArchived: false });
    vi.spyOn(client, "getVault").mockResolvedValue(
      createMockVault({
        id: 4n,
        balance: 10000000n,
        status: "Active",
      }),
    );

    let attempts = 0;
    vi.spyOn(client, "pingVault").mockImplementation(async () => {
      attempts += 1;
      throw new Error("RPC timeout simulated");
    });

    const alerts: KeeperAlert[] = [];
    const keeper = new HeirVaultKeeper({
      client,
      signer,
      vaultIds: [4n],
      maxRetries: 3,
      retryBackoffMs: 1, // fast backoff for tests
      onAlert: (alert) => alerts.push(alert),
    });

    const report = await keeper.runMaintenanceCycle();
    expect(attempts).toBe(3);
    expect(report.vaultsFailed).toBe(1);
    expect(alerts.some((a) => a.type === "ping_failed")).toBe(true);
  });
});

describe("KeypairSigner", () => {
  it("signs transaction envelope with local Keypair", async () => {
    const kp = Keypair.random();
    const signer = new KeypairSigner(kp);
    const address = await signer.getAddress();
    expect(address).toBe(kp.publicKey());
  });
});
