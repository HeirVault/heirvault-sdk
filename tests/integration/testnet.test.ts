/**
 * Opt-in Stellar Testnet integration tests.
 *
 * These are the only tests that talk to a real Soroban RPC endpoint. They are
 * excluded from `npm test` and run via:
 *
 *   HEIRVAULT_TESTNET_CONTRACT_ID=C... \
 *   HEIRVAULT_TESTNET_ACCOUNT=G... \
 *   npm run test:integration
 *
 * Read-only checks require only the two variables above. To also exercise a
 * write (`create_vault`), provide a funded Testnet secret for the account:
 *
 *   HEIRVAULT_TESTNET_SECRET=S...
 *
 * The secret is read from the environment, used to sign in-process and never
 * logged or written anywhere. When the variables are absent, the whole suite is
 * skipped — the SDK never fabricates a Testnet result.
 *
 * No transaction hashes are recorded here because this repository ships without
 * credentials; see the README for how to capture and report them.
 */

import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import { HeirVaultClient } from "../../src/client.js";
import { callbackSigner } from "../../src/signer.js";
import { toBaseUnits } from "../../src/amounts.js";

const CONTRACT_ID = process.env.HEIRVAULT_TESTNET_CONTRACT_ID?.trim();
const ACCOUNT = process.env.HEIRVAULT_TESTNET_ACCOUNT?.trim();
const SECRET = process.env.HEIRVAULT_TESTNET_SECRET?.trim();

const canRead = Boolean(CONTRACT_ID && ACCOUNT);
const suite = describe.runIf(canRead);

suite("HeirVault on Stellar Testnet", () => {
  let client: HeirVaultClient;

  beforeAll(() => {
    const secret = SECRET;
    const signer = secret
      ? callbackSigner(Keypair.fromSecret(secret).publicKey(), async (envelope) => {
          const tx = TransactionBuilder.fromXDR(
            envelope,
            "Test SDF Network ; September 2015",
          ) as Transaction;
          tx.sign(Keypair.fromSecret(secret));
          return tx.toXDR();
        })
      : undefined;

    client = new HeirVaultClient({
      contractId: CONTRACT_ID!,
      network: "testnet",
      readSourceAddress: ACCOUNT,
      ...(signer ? { signer } : {}),
    });
  });

  it("reports the running schema version (1 for this contract series)", async () => {
    const version = await client.schemaVersion();
    expect(version).toBe(1);
  });

  it("returns a non-negative vault count", async () => {
    const count = await client.getVaultCount();
    expect(count).toBeGreaterThanOrEqual(0n);
  });

  it("lists the account's vaults with paging metadata", async () => {
    const page = await client.getVaultsByOwner(ACCOUNT!, { limit: 25 });
    expect(Array.isArray(page.items)).toBe(true);
    expect(page.meta.limit).toBeLessThanOrEqual(25);
  });

  it("rejects a read for a vault that does not exist with VaultNotFound (#2)", async () => {
    // Vault ids are monotonic from 1, so a huge id is guaranteed absent.
    await expect(client.getVault(9_999_999_999n)).rejects.toMatchObject({ code: 2 });
  });

  describe.runIf(Boolean(SECRET))("write path (requires a funded secret)", () => {
    it("creates a vault and reads it back", async () => {
      const owner = Keypair.fromSecret(SECRET as string).publicKey();
      const asset = process.env.HEIRVAULT_TESTNET_ASSET?.trim();
      if (!asset) {
        throw new Error("HEIRVAULT_TESTNET_ASSET is required to create a vault.");
      }

      const created = await client.createVault({
        owner,
        asset,
        activationMode: "MissedCheckIn",
        checkInPeriodSeconds: 60,
        gracePeriodSeconds: 60,
      });
      expect(created.status).toBe("success");
      expect(created.value).toBeGreaterThan(0n);

      const vault = await client.getVault(created.value, { sourceAddress: owner });
      expect(vault.id).toBe(created.value);
      expect(vault.owner).toBe(owner);

      console.log(`[integration] create_vault confirmed: ${created.hash} (vault ${created.value})`);
    });

    it("converts a human amount to base units for a 7-decimal asset", () => {
      expect(toBaseUnits("100", 7)).toBe(1_000_000_000n);
    });
  });
});
