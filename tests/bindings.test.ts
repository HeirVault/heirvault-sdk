import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { bindings, HEIRVAULT_METHODS } from "../src/bindings.js";

const OWNER = "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ";
const ASSET = "CC6QRWVXN3V4UOADEZSGXNYRQMR252BXH6ERXOSENR64JTKIRCGA3ADO";
const HEIR = "GBWXARKI5DYF432O7O2IICAJLOT2DI6S4GDU2WJQXAPTR5FD2APEODC3";
const GUARDIAN = "GBT6KH3WDI2IRVR3QPYEGIYQPWQ7W255N7E6RMYQ766IVIHQG4LSOPWE";

const VAULT = 1n;

/** Decode every encoded argument back to a native value. */
function natives(values: xdr.ScVal[]): unknown[] {
  return values.map((value) => scValToNative(value));
}

describe("method names", () => {
  it("match the contract's #[contractimpl] entrypoints", () => {
    expect(HEIRVAULT_METHODS.createVault).toBe("create_vault");
    expect(HEIRVAULT_METHODS.deposit).toBe("deposit");
    expect(HEIRVAULT_METHODS.guardianApprove).toBe("guardian_approve");
    expect(HEIRVAULT_METHODS.activateVault).toBe("activate_vault");
    expect(HEIRVAULT_METHODS.getVaultsByBeneficiary).toBe("get_vaults_by_beneficiary");
    expect(HEIRVAULT_METHODS.schemaVersion).toBe("schema_version");
    // Every binding's declared method is the snake_case entrypoint.
    for (const binding of Object.values(bindings)) {
      expect(binding.method).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("argument encoding and order", () => {
  it("create_vault: owner, asset, activation_mode, check_in_period, grace_period", () => {
    const values = bindings.createVault.encode({
      owner: OWNER,
      asset: ASSET,
      activationMode: "MultiCondition",
      checkInPeriodSeconds: 86_400,
      gracePeriodSeconds: 3_600,
    });
    expect(values).toHaveLength(5);
    const [owner, asset, mode, checkIn, grace] = natives(values);
    expect(owner).toBe(OWNER);
    expect(asset).toBe(ASSET);
    expect(mode).toEqual(["MultiCondition"]);
    expect(checkIn).toBe(86_400n);
    expect(grace).toBe(3_600n);
  });

  it("deposit: vault_id, asset, amount (i128)", () => {
    const values = bindings.deposit.encode({ vaultId: VAULT, asset: ASSET, amount: 1_000_000_001n });
    const [id, asset, amount] = natives(values);
    expect(id).toBe(1n);
    expect(asset).toBe(ASSET);
    expect(amount).toBe(1_000_000_001n);
  });

  it("add_beneficiary: vault_id, beneficiary, allocation_bps (u32)", () => {
    const values = bindings.addBeneficiary.encode({ vaultId: VAULT, beneficiary: HEIR, allocationBps: 3333 });
    const [id, heir, bps] = natives(values);
    expect(id).toBe(1n);
    expect(heir).toBe(HEIR);
    expect(bps).toBe(3333);
  });

  it("remove_beneficiary / add_guardian / guardian_approve: vault_id, address", () => {
    expect(natives(bindings.removeBeneficiary.encode({ vaultId: VAULT, beneficiary: HEIR }))).toEqual([1n, HEIR]);
    expect(natives(bindings.addGuardian.encode({ vaultId: VAULT, guardian: GUARDIAN }))).toEqual([1n, GUARDIAN]);
    expect(natives(bindings.guardianApprove.encode({ vaultId: VAULT, guardian: GUARDIAN }))).toEqual([1n, GUARDIAN]);
  });

  it("withdraw: vault_id, amount (i128)", () => {
    expect(natives(bindings.withdraw.encode({ vaultId: VAULT, amount: 200_000_000n }))).toEqual([1n, 200_000_000n]);
  });

  it("claim: vault_id, beneficiary", () => {
    expect(natives(bindings.claim.encode({ vaultId: VAULT, beneficiary: HEIR }))).toEqual([1n, HEIR]);
  });

  it("single-argument calls encode exactly one u64", () => {
    for (const binding of [bindings.checkIn, bindings.activateVault, bindings.cancelVault, bindings.getVault]) {
      const values = binding.encode({ vaultId: 42n } as never);
      expect(values).toHaveLength(1);
      expect(natives(values)).toEqual([42n]);
    }
  });

  it("list reads encode address, offset, limit in order", () => {
    const [owner, offset, limit] = natives(
      bindings.getVaultsByOwner.encode({ owner: OWNER, offset: 25, limit: 10 }),
    );
    expect(owner).toBe(OWNER);
    expect(offset).toBe(25);
    expect(limit).toBe(10);
  });

  it("no-argument reads encode nothing", () => {
    expect(bindings.getVaultCount.encode()).toEqual([]);
    expect(bindings.schemaVersion.encode()).toEqual([]);
  });

  it("classifies writes and reads correctly", () => {
    expect(bindings.createVault.kind).toBe("write");
    expect(bindings.claim.kind).toBe("write");
    expect(bindings.getVault.kind).toBe("read");
    expect(bindings.isClaimable.kind).toBe("read");
  });

  it("keeps amounts above 2^53 exact end to end", () => {
    const huge = 170_141_183_460_469_231_731_687_303_715_884_105_727n;
    const tailored = bindings.deposit.encode({ vaultId: VAULT, asset: ASSET, amount: huge });
    expect(natives(tailored)[2]).toBe(huge);
  });
});
