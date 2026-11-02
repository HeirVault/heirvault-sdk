#!/usr/bin/env node
/**
 * HeirVault Keeper CLI Service
 *
 * Runs autonomous maintenance cycles on Stellar Soroban inheritance vaults.
 *
 * Usage:
 *   node scripts/run_keeper.mjs --once
 *   node scripts/run_keeper.mjs --interval 86400
 *   KEEPER_SECRET="S..." node scripts/run_keeper.mjs --vaults 1,2,9
 */

import { Keypair } from "@stellar/stellar-sdk";
import { HeirVaultClient } from "../dist/index.js";
import { HeirVaultKeeper } from "../dist/index.js";
import { KeypairSigner } from "../dist/index.js";

const DEFAULT_CONTRACT = "CB4I2OSSNXQCH3DGHKGYMG5DPDOUDD55YG3SSDOK4JICVDH5B7KLEWI6";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    contractId: process.env.CONTRACT_ID || DEFAULT_CONTRACT,
    network: "testnet",
    secret: process.env.KEEPER_SECRET || null,
    vaults: null,
    interval: null,
    once: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--contract" && args[i + 1]) {
      options.contractId = args[++i];
    } else if (arg === "--network" && args[i + 1]) {
      options.network = args[++i];
    } else if (arg === "--secret" && args[i + 1]) {
      options.secret = args[++i];
    } else if (arg === "--vaults" && args[i + 1]) {
      options.vaults = args[++i].split(",").map((v) => BigInt(v.trim()));
    } else if (arg === "--interval" && args[i + 1]) {
      options.interval = parseInt(args[++i], 10);
    } else if (arg === "--once") {
      options.once = true;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  console.log("==================================================");
  console.log("HeirVault Autonomous Keeper Service");
  console.log("==================================================");
  console.log(`Contract:   ${options.contractId}`);
  console.log(`Network:    ${options.network}`);

  let signer = undefined;
  if (options.secret) {
    const kp = Keypair.fromSecret(options.secret);
    signer = new KeypairSigner(kp);
    console.log(`Keeper Key: ${kp.publicKey()}`);
  } else {
    console.log("Notice: No keeper secret provided. Running in READ-ONLY audit/monitoring mode.");
  }

  const client = new HeirVaultClient({
    contractId: options.contractId,
    network: options.network,
    signer,
  });

  const keeper = new HeirVaultKeeper({
    client,
    signer,
    vaultIds: options.vaults || undefined,
    minKeeperBalanceXlm: 5,
    onAlert: (alert) => {
      console.warn(`[ALERT][${alert.level.toUpperCase()}][${alert.type}] ${alert.message}`);
    },
  });

  if (options.once || !options.interval) {
    console.log("\nExecuting single maintenance cycle...");
    const report = await keeper.runMaintenanceCycle();
    console.log("\n--- Maintenance Summary ---");
    console.log(`Scanned:  ${report.vaultsScanned}`);
    console.log(`Pinged:   ${report.vaultsPinged}`);
    console.log(`Skipped:  ${report.vaultsSkipped}`);
    console.log(`Archived: ${report.vaultsArchived}`);
    console.log(`Failed:   ${report.vaultsFailed}`);
    console.log(`Duration: ${report.durationMs}ms`);
    process.exit(report.vaultsFailed > 0 ? 1 : 0);
  } else {
    console.log(`\nStarting recurring daemon with interval: ${options.interval}s...`);
    keeper.startDaemon(options.interval);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
