/**
 * Full lifecycle example.
 *
 * Run with `npx tsx examples/full-lifecycle.ts` after setting the variables
 * documented in `.env.example`. Nothing here is executed by the test suite; it
 * exists as a documented, type-checked usage example.
 *
 * It mirrors what HeirVault-app does: configure a client, connect a signer,
 * create a vault through the resumable setup workflow, then run the inheritance
 * lifecycle. Only the SDK is used — no raw contract calls.
 */

import {
  HeirVaultClient,
  callbackSigner,
  fromBaseUnits,
  toBaseUnits,
  type WalletSigner,
} from "../src/index.js";

const CONTRACT_ID = process.env.HEIRVAULT_CONTRACT_ID ?? "";
const ASSET_ID = process.env.HEIRVAULT_ASSET_CONTRACT_ID ?? "";
const OWNER = process.env.HEIRVAULT_TESTNET_ACCOUNT ?? "";
const ASSET_DECIMALS = Number.parseInt(process.env.HEIRVAULT_ASSET_DECIMALS ?? "7", 10);

const OWNER_SECRET = process.env.HEIRVAULT_TESTNET_SECRET;
const HEIR = process.env.HEIRVAULT_HEIR ?? "";
const GUARDIAN = process.env.HEIRVAULT_GUARDIAN ?? "";

/** A trivial in-memory signer for illustration only. Never ship this. */
async function demoSigner(): Promise<WalletSigner> {
  const { Keypair } = await import("@stellar/stellar-sdk");
  if (!OWNER_SECRET) throw new Error("HEIRVAULT_TESTNET_SECRET is required for the example.");
  const keypair = Keypair.fromSecret(OWNER_SECRET);
  return callbackSigner(keypair.publicKey(), async (envelope) => {
    const { TransactionBuilder, Transaction } = await import("@stellar/stellar-sdk");
    const tx = TransactionBuilder.fromXDR(envelope, "Test SDF Network ; September 2015") as InstanceType<
      typeof Transaction
    >;
    tx.sign(keypair);
    return tx.toXDR();
  });
}

async function main(): Promise<void> {
  const client = new HeirVaultClient({
    contractId: CONTRACT_ID,
    network: "testnet",
    signer: await demoSigner(),
    asset: { contractId: ASSET_ID, symbol: "USDC", decimals: ASSET_DECIMALS },
  });

  console.log("schema version:", await client.schemaVersion());

  // 1. Create the vault and configure it as a series of resumable steps.
  const setup = await client.createVaultWithSetup(
    {
      owner: OWNER,
      asset: ASSET_ID,
      activationMode: "MultiCondition",
      checkInPeriodSeconds: 90 * 86_400,
      gracePeriodSeconds: 30 * 86_400,
    },
    [
      { type: "addBeneficiary", beneficiary: HEIR, allocationBps: 10_000 },
      { type: "addGuardian", guardian: GUARDIAN },
      { type: "setGuardianThreshold", threshold: 1 },
      { type: "deposit", amount: toBaseUnits("1000", ASSET_DECIMALS) },
    ],
  );

  console.log(`vault ${setup.vaultId} created (${setup.createHash}); completed=${setup.completed}`);
  if (!setup.completed) {
    console.warn("resume these steps:", setup.remaining);
    return;
  }

  // 2. Read back what the chain holds.
  const vault = await client.getVault(setup.vaultId);
  console.log("status:", vault.effectiveStatus, "balance:", fromBaseUnits(vault.balance, ASSET_DECIMALS));

  // 3. The owner keeps the vault alive.
  const deadline = await client.checkIn(setup.vaultId);
  console.log("next deadline:", new Date(Number(deadline.value) * 1000).toISOString());

  // 4. When eligible, release and claim.
  if (await client.isClaimable(setup.vaultId)) {
    await client.activateVault(setup.vaultId);
    const paid = await client.claim(setup.vaultId, HEIR);
    console.log("heir claimed:", fromBaseUnits(paid.value, ASSET_DECIMALS));
  } else {
    console.log("not claimable yet — guardians/grace period not satisfied");
  }
}

void main();
