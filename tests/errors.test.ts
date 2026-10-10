import { describe, expect, it } from "vitest";

import {
  HeirVaultContractError,
  HeirVaultErrorCode,
  HeirVaultSdkError,
  heirVaultErrorName,
  parseContractErrorCode,
  toHeirVaultError,
} from "../src/errors.js";

describe("error code table", () => {
  it("matches the contract's numeric ABI", () => {
    expect(HeirVaultErrorCode.Unauthorized).toBe(1);
    expect(HeirVaultErrorCode.NotEligible).toBe(34);
    expect(HeirVaultErrorCode.GracePeriodExpired).toBe(42);
    expect(HeirVaultErrorCode.AlreadyClaimed).toBe(50);
    expect(HeirVaultErrorCode.ArithmeticOverflow).toBe(61);
  });

  it("resolves names, including unknown codes", () => {
    expect(heirVaultErrorName(34)).toBe("NotEligible");
    expect(heirVaultErrorName(999)).toBe("UnknownError(999)");
  });
});

describe("parseContractErrorCode", () => {
  it("parses the diagnostic-event / simulation string form", () => {
    expect(parseContractErrorCode("HostError: Error(Contract, #34)")).toBe(34);
    expect(parseContractErrorCode("Error(Contract, #42)")).toBe(42);
  });

  it("parses a decoded result object", () => {
    expect(parseContractErrorCode({ contractCode: 25 })).toBe(25);
    expect(parseContractErrorCode({ code: 50 })).toBe(50);
  });

  it("returns undefined when no code is present", () => {
    expect(parseContractErrorCode("something else")).toBeUndefined();
    expect(parseContractErrorCode(undefined)).toBeUndefined();
    expect(parseContractErrorCode({})).toBeUndefined();
  });
});

describe("toHeirVaultError", () => {
  it("promotes a contract code to a typed contract error", () => {
    const error = toHeirVaultError(new Error("Error(Contract, #51)"));
    expect(error).toBeInstanceOf(HeirVaultContractError);
    expect((error as HeirVaultContractError).code).toBe(51);
    expect((error as HeirVaultContractError).errorName).toBe("InsufficientBalance");
  });

  it("passes an existing SDK error through unchanged", () => {
    const original = new HeirVaultSdkError("nope");
    expect(toHeirVaultError(original)).toBe(original);
  });

  it("wraps an unknown value", () => {
    expect(toHeirVaultError("boom").message).toBe("boom");
  });
});
