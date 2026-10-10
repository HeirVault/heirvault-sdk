import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { HeirVaultClient } from "../src/client.js";
import { enumToScVal, u32ToScVal, u64ToScVal } from "../src/codec.js";
import { InvalidArgumentError, SignerNotConfiguredError } from "../src/errors.js";
import {
  TEST_CONTRACT,
  errorSimulation,
  fakeServer,
  invokedContract,
  invokedMethod,
  signingSigner,
  successSimulation,
  successTx,
} from "./helpers.js";

const OWNER = "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ";
const ASSET = "CCQACXRCTDFOGOMP6NGJVGASIS3LG4B6WN4H74JNJTQFRBTBMQZ2SMGB";
const HEIR = "GBWXARKI5DYF432O7O2IICAJLOT2DI6S4GDU2WJQXAPTR5FD2APEODC3";
const GUARDIAN = "GBT6KH3WDI2IRVR3QPYEGIYQPWQ7W255N7E6RMYQ766IVIHQG4LSOPWE";

describe("reads", () => {
  it("simulates get_vault_count against the configured contract", async () => {
    const fake = fakeServer({ simulations: [successSimulation(u64ToScVal(5n))] });
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", server: fake.server });

    await expect(client.getVaultCount()).resolves.toBe(5n);
    expect(invokedMethod(fake.simulated[0]!)).toBe("get_vault_count");
    expect(invokedContract(fake.simulated[0]!)).toBe(TEST_CONTRACT);
  });

  it("decodes an enum status", async () => {
    const fake = fakeServer({ simulations: [successSimulation(enumToScVal("GracePeriod"))] });
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", server: fake.server });

    await expect(client.getVaultStatus(1)).resolves.toBe("GracePeriod");
    expect(invokedMethod(fake.simulated[0]!)).toBe("get_vault_status");
  });

  it("decodes a u32 read as a number", async () => {
    const fake = fakeServer({ simulations: [successSimulation(u32ToScVal(10_000))] });
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", server: fake.server });

    await expect(client.getTotalAllocation("1")).resolves.toBe(10_000);
  });

  it("surfaces a simulation error on a read", async () => {
    const fake = fakeServer({ simulations: [errorSimulation("Error(Contract, #2)")] });
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", server: fake.server });

    await expect(client.getVault(999)).rejects.toMatchObject({ code: 2 });
  });
});

describe("write source resolution", () => {
  it("uses the owner as the source of create_vault", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(u64ToScVal(7n))],
      transactions: [successTx(u64ToScVal(7n))],
    });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      signer,
      server: fake.server,
    });

    const result = await client.createVault({
      owner: OWNER,
      asset: ASSET,
      activationMode: "MissedCheckIn",
      checkInPeriodSeconds: 3600,
      gracePeriodSeconds: 600,
    });

    expect(result.value).toBe(7n);
    expect(invokedMethod(fake.simulated[0]!)).toBe("create_vault");
    expect(fake.simulated[0]!.source).toBe(OWNER);
  });

  it("uses the guardian as the source of guardian_approve", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      transactions: [successTx(xdr.ScVal.scvVoid())],
    });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      signer,
      server: fake.server,
    });

    await client.guardianApprove(2, GUARDIAN);
    expect(fake.simulated[0]!.source).toBe(GUARDIAN);
  });

  it("requires a signer for writes", async () => {
    const fake = fakeServer({ simulations: [successSimulation(u64ToScVal(1n))] });
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", server: fake.server });

    await expect(
      client.createVault({
        owner: OWNER,
        asset: ASSET,
        activationMode: "MissedCheckIn",
        checkInPeriodSeconds: 60,
        gracePeriodSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(SignerNotConfiguredError);
  });

  it("requires an asset contract id for deposit", async () => {
    const { signer } = signingSigner();
    const client = new HeirVaultClient({ contractId: TEST_CONTRACT, network: "testnet", signer });

    await expect(client.deposit(1, 1n)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("encodes a deposit against the configured asset", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      transactions: [successTx(xdr.ScVal.scvVoid())],
    });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      signer,
      server: fake.server,
      asset: { contractId: ASSET, symbol: "HVUSD", decimals: 7 },
    });

    const result = await client.deposit(1, 1_000_000_001n);
    expect(result.value).toBeUndefined();
    expect(invokedMethod(fake.simulated[0]!)).toBe("deposit");
  });
});

describe("createVaultWithSetup", () => {
  it("returns the created id and stops at the first failing step", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({
      simulations: [
        successSimulation(u64ToScVal(7n)), // create_vault
        successSimulation(xdr.ScVal.scvVoid()), // add_beneficiary
        errorSimulation("Error(Contract, #13)"), // add_guardian would fail
      ],
      transactions: [successTx(u64ToScVal(7n)), successTx(xdr.ScVal.scvVoid())],
    });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      signer,
      server: fake.server,
    });

    const result = await client.createVaultWithSetup(
      {
        owner: OWNER,
        asset: ASSET,
        activationMode: "GuardianApproval",
        checkInPeriodSeconds: 86_400,
        gracePeriodSeconds: 86_400,
      },
      [
        { type: "addBeneficiary", beneficiary: HEIR, allocationBps: 10_000 },
        { type: "addGuardian", guardian: GUARDIAN },
      ],
    );

    expect(result.vaultId).toBe(7n);
    expect(result.completed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ ok: true });
    expect(result.steps[1]).toMatchObject({ ok: false });
    expect(result.remaining).toEqual([{ type: "addGuardian", guardian: GUARDIAN }]);
  });

  it("reports completion when every step succeeds", async () => {
    const { signer } = signingSigner();
    const fake = fakeServer({
      simulations: [
        successSimulation(u64ToScVal(3n)),
        successSimulation(xdr.ScVal.scvVoid()),
        successSimulation(xdr.ScVal.scvVoid()),
      ],
      transactions: [successTx(u64ToScVal(3n)), successTx(xdr.ScVal.scvVoid())],
    });
    const client = new HeirVaultClient({
      contractId: TEST_CONTRACT,
      network: "testnet",
      signer,
      server: fake.server,
      asset: { contractId: ASSET, decimals: 7 },
    });

    const result = await client.createVaultWithSetup(
      { owner: OWNER, asset: ASSET, activationMode: "MissedCheckIn", checkInPeriodSeconds: 60, gracePeriodSeconds: 60 },
      [
        { type: "addBeneficiary", beneficiary: HEIR, allocationBps: 10_000 },
        { type: "deposit", amount: 1_000n },
      ],
    );

    expect(result.completed).toBe(true);
    expect(result.remaining).toEqual([]);
    expect(result.steps.every((step) => step.ok)).toBe(true);
  });
});
