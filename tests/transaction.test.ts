import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { decodeU64, u64ToScVal } from "../src/codec.js";
import {
  ConfirmationTimeoutError,
  SimulationError,
  TransactionFailedError,
  WalletRejectedError,
} from "../src/errors.js";
import { submitInvocation, trySubmitInvocation } from "../src/transaction.js";
import type { WalletSigner } from "../src/signer.js";
import {
  TEST_CONTRACT,
  TEST_PASSPHRASE,
  errorSimulation,
  fakeServer,
  failedTx,
  notFoundTx,
  signingSigner,
  successSimulation,
  successTx,
} from "./helpers.js";

const METHOD = "check_in";
const OWNER = "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ";

function baseParams(server: ReturnType<typeof fakeServer>["server"], signer: WalletSigner, address: string) {
  return {
    server,
    networkPassphrase: TEST_PASSPHRASE,
    contractId: TEST_CONTRACT,
    method: METHOD,
    args: [u64ToScVal(1n)],
    signer,
    sourceAddress: address,
    decode: decodeU64,
    pollIntervalMs: 1,
  };
}

describe("submitInvocation", () => {
  it("returns success only after the ledger confirms the hash", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(u64ToScVal(1_791_540_102n))],
      transactions: [successTx(u64ToScVal(1_791_540_102n), 99)],
    });

    const phases: string[] = [];
    const result = await submitInvocation({
      ...baseParams(fake.server, signer, keypair.publicKey()),
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.status).toBe("success");
    expect(result.value).toBe(1_791_540_102n);
    expect(result.ledger).toBe(99);
    expect(result.hash).toBe("00".repeat(32));
    expect(phases).toEqual([
      "building",
      "simulating",
      "awaiting-signature",
      "submitted",
      "confirming",
      "success",
    ]);
  });

  it("surfaces a simulation failure with the contract error code", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({ simulations: [errorSimulation("HostError: Error(Contract, #34)")] });

    await expect(submitInvocation(baseParams(fake.server, signer, keypair.publicKey()))).rejects.toBeInstanceOf(
      SimulationError,
    );

    try {
      await submitInvocation(baseParams(fake.server, signer, keypair.publicKey()));
    } catch (error) {
      expect((error as SimulationError).code).toBe(34);
    }
  });

  it("reports a rejected signature as a WalletRejectedError, never success", async () => {
    const fake = fakeServer({ simulations: [successSimulation(u64ToScVal(1n))] });
    const rejectingSigner: WalletSigner = {
      getAddress: async () => OWNER,
      signTransaction: async () => {
        throw new Error("user closed the wallet");
      },
    };

    await expect(submitInvocation(baseParams(fake.server, rejectingSigner, OWNER))).rejects.toBeInstanceOf(
      WalletRejectedError,
    );
  });

  it("reports an on-chain failure with the transaction hash", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      transactions: [failedTx()],
    });

    try {
      await submitInvocation(baseParams(fake.server, signer, keypair.publicKey()));
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionFailedError);
      expect((error as TransactionFailedError).hash).toBe("00".repeat(32));
    }
  });

  it("throws a confirmation timeout when the transaction never lands", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      transactions: [notFoundTx()],
    });

    await expect(
      submitInvocation({ ...baseParams(fake.server, signer, keypair.publicKey()), pollAttempts: 3 }),
    ).rejects.toBeInstanceOf(ConfirmationTimeoutError);
  });

  it("reports the partial `pending` phase (not success) on timeout", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      transactions: [notFoundTx()],
    });

    const outcome = await trySubmitInvocation({
      ...baseParams(fake.server, signer, keypair.publicKey()),
      pollAttempts: 2,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.phase).toBe("pending");
  });

  it("wraps an RPC send error in a TransactionFailedError", async () => {
    const { signer, keypair } = signingSigner();
    const fake = fakeServer({
      simulations: [successSimulation(xdr.ScVal.scvVoid())],
      send: { status: "ERROR", hash: "aa".repeat(32) },
    });

    await expect(submitInvocation(baseParams(fake.server, signer, keypair.publicKey()))).rejects.toBeInstanceOf(
      TransactionFailedError,
    );
  });
});

describe("trySubmitInvocation", () => {
  it("returns a discriminated union instead of throwing", async () => {
    const { signer, keypair } = signingSigner();
    const ok = fakeServer({
      simulations: [successSimulation(u64ToScVal(5n))],
      transactions: [successTx(u64ToScVal(5n))],
    });
    const successOutcome = await trySubmitInvocation(baseParams(ok.server, signer, keypair.publicKey()));
    expect(successOutcome.ok).toBe(true);

    const bad = fakeServer({ simulations: [errorSimulation("Error(Contract, #42)")] });
    const failureOutcome = await trySubmitInvocation(baseParams(bad.server, signer, keypair.publicKey()));
    expect(failureOutcome.ok).toBe(false);
    if (!failureOutcome.ok) {
      expect(failureOutcome.phase).toBe("failed");
    }
  });

  it("classifies a rejected signature with the `rejected` phase", async () => {
    const fake = fakeServer({ simulations: [successSimulation(xdr.ScVal.scvVoid())] });
    const rejectingSigner: WalletSigner = {
      getAddress: vi.fn(async () => "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ"),
      signTransaction: async () => {
        throw new WalletRejectedError();
      },
    };
    const outcome = await trySubmitInvocation(
      baseParams(fake.server, rejectingSigner, "GD6VQRYCTXXEGP5RGS2A6VO2FT773RGNY2UE77OL5ZOVYEV67TNQMZKQ"),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.phase).toBe("rejected");
  });
});
