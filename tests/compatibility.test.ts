import { describe, expect, it } from "vitest";

import {
  ACTIVATION_MODES,
  BPS_DENOMINATOR,
  FULL_ALLOCATION_BPS,
  HEIRVAULT_ERROR_NAMES,
  HEIRVAULT_METHODS,
  HeirVaultErrorCode,
  MAX_BENEFICIARIES,
  MAX_CHECK_IN_PERIOD,
  MAX_GRACE_PERIOD,
  MAX_GUARDIANS,
  MAX_PAGE_LIMIT,
  MIN_CHECK_IN_PERIOD,
  MIN_GRACE_PERIOD,
  SCHEMA_VERSION,
  VAULT_STATUSES,
  bindings,
  heirVaultErrorName,
} from "../src/index.js";

/**
 * Authoritative 30 entrypoints exposed by `contracts/heirvault/src/lib.rs` (contract v0.1.0).
 */
const CANONICAL_CONTRACT_ENTRYPOINTS = [
  "create_vault",
  "deposit",
  "add_beneficiary",
  "remove_beneficiary",
  "update_beneficiary",
  "get_beneficiaries",
  "get_active_beneficiaries",
  "get_total_allocation",
  "add_guardian",
  "remove_guardian",
  "set_guardian_threshold",
  "guardian_approve",
  "get_guardians",
  "get_guardian_status",
  "check_in",
  "activate_vault",
  "cancel_vault",
  "withdraw",
  "claim",
  "get_claims",
  "get_claim",
  "get_undistributed_balance",
  "get_vault",
  "get_vault_status",
  "get_deadlines",
  "is_claimable",
  "get_vaults_by_owner",
  "get_vault_count",
  "get_vaults_by_beneficiary",
  "schema_version",
] as const;

/**
 * Authoritative error codes defined by `contracts/heirvault/src/errors.rs`.
 */
const CANONICAL_ERROR_CODES: Record<number, string> = {
  1: "Unauthorized",
  2: "VaultNotFound",
  3: "VaultAlreadyExists",
  4: "InvalidAsset",
  5: "InvalidAddress",
  6: "NotInitialized",
  10: "InvalidAmount",
  11: "InvalidBeneficiary",
  12: "InvalidAllocation",
  13: "AllocationExceeded",
  14: "AllocationIncomplete",
  15: "NoBeneficiaries",
  16: "TooManyBeneficiaries",
  17: "DuplicateBeneficiary",
  20: "InvalidGuardian",
  21: "InvalidThreshold",
  22: "TooManyGuardians",
  23: "DuplicateGuardian",
  24: "AlreadyApproved",
  25: "ApprovalNotEnabled",
  30: "InvalidState",
  31: "VaultNotEditable",
  32: "AlreadyActivated",
  33: "NotActivated",
  34: "NotEligible",
  35: "VaultCancelled",
  36: "VaultCompleted",
  40: "DeadlineNotReached",
  41: "GracePeriodActive",
  42: "GracePeriodExpired",
  43: "InvalidPeriod",
  50: "AlreadyClaimed",
  51: "InsufficientBalance",
  60: "InvalidPageLimit",
  61: "ArithmeticOverflow",
};

describe("Contract-SDK Interface Compatibility", () => {
  it("implements all 30 public contract entrypoints with exact snake_case names", () => {
    const implementedMethods = Object.values(HEIRVAULT_METHODS);
    expect(implementedMethods.sort()).toEqual([...CANONICAL_CONTRACT_ENTRYPOINTS].sort());
    expect(implementedMethods).toHaveLength(30);

    for (const entrypoint of CANONICAL_CONTRACT_ENTRYPOINTS) {
      expect(implementedMethods).toContain(entrypoint);
    }
  });

  it("every entrypoint in HEIRVAULT_METHODS has an active binding encoder/decoder", () => {
    const boundMethods = Object.values(bindings).map((b) => b.method);
    for (const method of Object.values(HEIRVAULT_METHODS)) {
      expect(boundMethods).toContain(method);
    }
  });

  it("matches all numeric contract error codes and symbolic names exactly", () => {
    for (const [codeStr, name] of Object.entries(CANONICAL_ERROR_CODES)) {
      const code = Number(codeStr);
      expect(HeirVaultErrorCode[name as keyof typeof HeirVaultErrorCode]).toBe(code);
      expect(heirVaultErrorName(code)).toBe(name);
      expect(HEIRVAULT_ERROR_NAMES[code]).toBe(name);
    }
  });

  it("matches all lifecycle contract constants exactly", () => {
    expect(BPS_DENOMINATOR).toBe(10_000);
    expect(FULL_ALLOCATION_BPS).toBe(10_000);
    expect(MAX_BENEFICIARIES).toBe(10);
    expect(MAX_GUARDIANS).toBe(5);
    expect(MAX_PAGE_LIMIT).toBe(25);
    expect(MIN_CHECK_IN_PERIOD).toBe(60);
    expect(MAX_CHECK_IN_PERIOD).toBe(5 * 365 * 24 * 60 * 60);
    expect(MIN_GRACE_PERIOD).toBe(60);
    expect(MAX_GRACE_PERIOD).toBe(365 * 24 * 60 * 60);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("matches contract state enums and variants", () => {
    expect(ACTIVATION_MODES).toEqual(["MissedCheckIn", "GuardianApproval", "MultiCondition"]);
    expect(VAULT_STATUSES).toEqual(["Active", "GracePeriod", "Activated", "Cancelled", "Completed"]);
  });
});
