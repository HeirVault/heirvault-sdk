/**
 * Token amount utilities.
 *
 * Soroban transfers `i128` base units. Converting between a human decimal
 * string and base units must never go through a JavaScript `number`, because
 * IEEE-754 doubles lose precision above 2^53 and would silently corrupt large
 * balances. Everything here is exact string/bigint arithmetic.
 */

import { InvalidArgumentError } from "./errors.js";

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Convert a human decimal amount into base units.
 *
 * `toBaseUnits("12.5", 7)` → `125000000n`.
 *
 * Rejects negative values, scientific notation and any amount that carries
 * more decimal places than the asset supports (silently truncating would lose
 * the user's funds).
 */
export function toBaseUnits(amount: string | number | bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new InvalidArgumentError(`Asset decimals must be an integer between 0 and 38, received ${decimals}.`);
  }

  if (typeof amount === "bigint") return amount;

  const text = typeof amount === "number" ? String(amount) : amount.trim();
  if (text === "") throw new InvalidArgumentError("Amount must not be empty.");
  if (!DECIMAL_PATTERN.test(text)) {
    throw new InvalidArgumentError(`"${amount}" is not a valid positive decimal amount.`);
  }

  const [wholePart, fractionPart = ""] = text.split(".");
  const whole = wholePart ?? "0";
  if (fractionPart.length > decimals) {
    throw new InvalidArgumentError(
      `"${amount}" has more than ${decimals} decimal places, which this asset cannot represent.`,
    );
  }
  const paddedFraction = fractionPart.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`);
}

/**
 * Convert base units back into a human decimal string.
 *
 * `fromBaseUnits(125000000n, 7)` → `"12.5"`. Trailing zeros in the fraction are
 * trimmed, so the output is the shortest exact representation.
 */
export function fromBaseUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new InvalidArgumentError(`Asset decimals must be a non-negative integer, received ${decimals}.`);
  }
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const trimmedFraction = fraction.replace(/0+$/, "");
  const result = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return negative ? `-${result}` : result;
}

/** Sum a list of decimal amounts using exact base-unit arithmetic. */
export function sumAmounts(amounts: readonly string[], decimals: number): string {
  const total = amounts.reduce((acc, amount) => acc + toBaseUnits(amount, decimals), 0n);
  return fromBaseUnits(total, decimals);
}

/**
 * Compute `floor(total * bps / 10_000)` with checked bigint arithmetic.
 *
 * This mirrors the contract's `share_of`, including its floor rounding.
 */
export function applyBps(total: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new InvalidArgumentError(`Basis points must be a non-negative integer, received ${bps}.`);
  }
  return (total * BigInt(bps)) / 10_000n;
}

/** Basis points → percentage (`10000` → `100`). */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** Percentage → basis points (`100` → `10000`). Rounded to the nearest bp. */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** Human label for an allocation, e.g. `3333` bps → `"33.33%"`. */
export function formatAllocation(bps: number): string {
  const percent = bpsToPercent(bps);
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, "");
  return `${text}%`;
}

/** Sum of a beneficiary list's basis points (active slots only). */
export function totalAllocationBps(
  beneficiaries: readonly { allocationBps: number; active?: boolean }[],
): number {
  return beneficiaries.reduce(
    (sum, entry) => (entry.active === false ? sum : sum + entry.allocationBps),
    0,
  );
}
