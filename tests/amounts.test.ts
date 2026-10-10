import { describe, expect, it } from "vitest";

import {
  applyBps,
  bpsToPercent,
  formatAllocation,
  fromBaseUnits,
  percentToBps,
  sumAmounts,
  toBaseUnits,
  totalAllocationBps,
} from "../src/amounts.js";
import { InvalidArgumentError } from "../src/errors.js";

describe("toBaseUnits", () => {
  it("scales a decimal string by the asset decimals", () => {
    expect(toBaseUnits("12.5", 7)).toBe(125_000_000n);
    expect(toBaseUnits("1", 0)).toBe(1n);
    expect(toBaseUnits("0.0000001", 7)).toBe(1n);
    expect(toBaseUnits("25", 7)).toBe(250_000_000n);
  });

  it("is exact beyond Number.MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_993 * 10^7 base units — impossible with a float.
    expect(toBaseUnits("9007199254740993.0000001", 7)).toBe(90_071_992_547_409_930_000_001n);
  });

  it("handles a leading zero whole part", () => {
    expect(toBaseUnits("0.5", 2)).toBe(50n);
  });

  it("rejects too many decimal places instead of truncating", () => {
    expect(() => toBaseUnits("1.23456789", 7)).toThrow(InvalidArgumentError);
  });

  it("rejects negative, malformed and scientific input", () => {
    for (const bad of ["-1", "1e3", "abc", "", "1.2.3"]) {
      expect(() => toBaseUnits(bad, 7)).toThrow(InvalidArgumentError);
    }
  });

  it("passes a bigint through unchanged", () => {
    expect(toBaseUnits(123n, 7)).toBe(123n);
  });
});

describe("fromBaseUnits", () => {
  it("is the inverse of toBaseUnits", () => {
    for (const amount of ["0", "0.0000001", "12.5", "9007199254740993.0000001"]) {
      expect(fromBaseUnits(toBaseUnits(amount, 7), 7)).toBe(amount.replace(/\.?0+$/, "") || "0");
    }
  });

  it("handles zero and whole numbers", () => {
    expect(fromBaseUnits(0n, 7)).toBe("0");
    expect(fromBaseUnits(250_000_000n, 7)).toBe("25");
  });
});

describe("sumAmounts", () => {
  it("sums without floating-point drift", () => {
    expect(sumAmounts(["0.1", "0.2"], 1)).toBe("0.3");
  });
});

describe("allocation helpers", () => {
  it("applies basis points with floor rounding (matching the contract)", () => {
    // 1_000_000_001 * 3333 / 10000 = 333_300_000.3333 → floor 333_300_000
    expect(applyBps(1_000_000_001n, 3333)).toBe(333_300_000n);
    expect(applyBps(1000n, 0)).toBe(0n);
    expect(applyBps(1000n, 10_000)).toBe(1000n);
  });

  it("converts between bps and percent", () => {
    expect(bpsToPercent(10_000)).toBe(100);
    expect(percentToBps(33.33)).toBe(3333);
  });

  it("formats allocations", () => {
    expect(formatAllocation(10_000)).toBe("100%");
    expect(formatAllocation(3333)).toBe("33.33%");
  });

  it("totals active allocations and ignores inactive slots", () => {
    expect(
      totalAllocationBps([
        { allocationBps: 6000, active: true },
        { allocationBps: 4000, active: true },
        { allocationBps: 2500, active: false },
      ]),
    ).toBe(10_000);
  });
});
