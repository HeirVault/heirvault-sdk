import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  activationModeToScVal,
  decodeActivationMode,
  decodeBeneficiary,
  decodeClaimRecord,
  decodeDeadlines,
  decodeGuardianStatus,
  decodePageMeta,
  decodeU64,
  decodeVaultInfo,
  decodeVaultStatus,
  enumToScVal,
  parseVaultId,
  secondsToIso,
  toBigInt,
  u32ToScVal,
  u64ToScVal,
} from "../src/codec.js";
import { DecodeError } from "../src/errors.js";

const OWNER = "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ";
const ASSET = "CC6QRWVXN3V4UOADEZSGXNYRQMR252BXH6ERXOSENR64JTKIRCGA3ADO";
const HEIR = "GBWXARKI5DYF432O7O2IICAJLOT2DI6S4GDU2WJQXAPTR5FD2APEODC3";

/** A native (post-`scValToNative`) VaultInfo, exactly as the host would produce it. */
function nativeVaultInfo() {
  return {
    vault: {
      id: 1n,
      owner: OWNER,
      asset: ASSET,
      balance: 1_000_000_001n,
      status: ["Active"],
      activation_mode: ["MissedCheckIn"],
      check_in_period: 3600n,
      grace_period: 600n,
      last_check_in: 1_791_536_502n,
      last_status_change: 1_791_536_502n,
      activated_at: 0n,
      distribution_balance: 0n,
      total_claimed: 0n,
      claimed_count: 0,
      beneficiaries: [
        { address: HEIR, allocation_bps: 10_000, active: true, claimed: false, claimed_amount: 0n },
      ],
      guardians: [{ address: OWNER, active: true, approved: false }],
      guardian_threshold: 1,
      guardian_approvals: 0,
      created_at: 1_791_536_502n,
      schema_version: 1,
    },
    deadline: 1_791_540_102n,
    grace_end: 1_791_540_702n,
    effective_status: ["Active"],
    total_allocation_bps: 10_000,
    guardian_threshold: 1,
    guardian_approvals: 0,
    activation_ready: false,
  };
}

describe("enum encoding", () => {
  it("encodes a unit variant as ScVec[Symbol], not a bare Symbol", () => {
    const scval = enumToScVal("MissedCheckIn");
    expect(scval.switch().name).toBe("scvVec");
    expect(scValToNative(scval)).toEqual(["MissedCheckIn"]);
  });

  it("encodes every activation mode", () => {
    for (const mode of ["MissedCheckIn", "GuardianApproval", "MultiCondition"] as const) {
      expect(scValToNative(activationModeToScVal(mode))).toEqual([mode]);
    }
  });

  it("decodes both the vector and bare-symbol shapes", () => {
    expect(decodeActivationMode(["GuardianApproval"])).toBe("GuardianApproval");
    expect(decodeActivationMode("MultiCondition")).toBe("MultiCondition");
  });

  it("rejects an unknown variant", () => {
    expect(() => decodeVaultStatus(["Nonsense"])).toThrow(DecodeError);
  });
});

describe("parseVaultId", () => {
  it("accepts strings, numbers and bigints", () => {
    expect(parseVaultId("12")).toBe(12n);
    expect(parseVaultId(12)).toBe(12n);
    expect(parseVaultId(12n)).toBe(12n);
  });

  it("rejects malformed ids", () => {
    for (const bad of ["abc", "-1", "1.5", 1.5]) {
      expect(() => parseVaultId(bad)).toThrow(DecodeError);
    }
  });
});

describe("decodeVaultInfo", () => {
  it("flattens the stored record and the derived fields", () => {
    const vault = decodeVaultInfo(nativeVaultInfo());
    expect(vault.id).toBe(1n);
    expect(vault.owner).toBe(OWNER);
    expect(vault.balance).toBe(1_000_000_001n);
    expect(vault.status).toBe("Active");
    expect(vault.activationMode).toBe("MissedCheckIn");
    expect(vault.effectiveStatus).toBe("Active");
    expect(vault.totalAllocationBps).toBe(10_000);
    expect(vault.activationReady).toBe(false);
    expect(vault.beneficiaries[0]).toMatchObject({ address: HEIR, allocationBps: 10_000, active: true });
    expect(vault.guardians[0]).toMatchObject({ address: OWNER, active: true, approved: false });
    expect(vault.activatedAt).toBeNull();
    expect(vault.deadline).toBe(new Date(1_791_540_102 * 1000).toISOString());
  });

  it("fails clearly on a malformed record", () => {
    expect(() => decodeVaultInfo({ vault: {}, deadline: 1n, grace_end: 2n, effective_status: ["Active"] })).toThrow(
      DecodeError,
    );
  });
});

describe("scalar and struct decoders", () => {
  it("decodes scalar integers", () => {
    expect(decodeU64(scValToNative(u64ToScVal(9_007_199_254_740_993n)))).toBe(9_007_199_254_740_993n);
    expect(toBigInt(scValToNative(u32ToScVal(25)), "u32")).toBe(25n);
  });

  it("decodes a beneficiary", () => {
    expect(
      decodeBeneficiary({ address: HEIR, allocation_bps: 6000, active: true, claimed: true, claimed_amount: 42n }),
    ).toEqual({ address: HEIR, allocationBps: 6000, active: true, claimed: true, claimedAmount: 42n });
  });

  it("decodes a claim record", () => {
    const record = decodeClaimRecord({
      beneficiary: HEIR,
      allocation_bps: 3333,
      entitlement: 333_300_000n,
      claimed_amount: 333_300_000n,
      claimed: true,
    });
    expect(record.entitlement).toBe(333_300_000n);
    expect(record.claimed).toBe(true);
  });

  it("decodes page metadata including the Option next_offset", () => {
    expect(
      decodePageMeta({ total: 30, offset: 0, limit: 25, has_more: true, next_offset: 25 }, "meta"),
    ).toEqual({ total: 30, offset: 0, limit: 25, hasMore: true, nextOffset: 25 });
    expect(
      decodePageMeta({ total: 3, offset: 0, limit: 25, has_more: false, next_offset: null }, "meta"),
    ).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("decodes deadlines and guardian status", () => {
    const deadlines = decodeDeadlines({ deadline: 100n, grace_end: 200n, now: 50n });
    expect(deadlines.deadlineSeconds).toBe(100);
    expect(deadlines.graceEndSeconds).toBe(200);
    expect(deadlines.nowSeconds).toBe(50);

    expect(
      decodeGuardianStatus({ approvals: 2, threshold: 2, guardian_count: 2, threshold_met: true }),
    ).toEqual({ approvals: 2, threshold: 2, guardianCount: 2, thresholdMet: true });
  });

  it("converts timestamps, treating 0 as unset", () => {
    expect(secondsToIso(0)).toBeNull();
    expect(secondsToIso(1_700_000_000)).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});
