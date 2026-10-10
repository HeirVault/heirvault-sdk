/**
 * Wallet signer abstraction.
 *
 * The SDK never holds a secret key and never asks for one. Signing is delegated
 * to a {@link WalletSigner} supplied by the caller, which keeps the SDK usable
 * in a browser extension, a hardware wallet, a server-side signer or a test
 * double — without the SDK knowing which.
 *
 * A Freighter-backed implementation is provided for convenience but is an
 * *optional* peer dependency: importing the SDK never requires it. The frontend
 * can equally wrap its own wallet adapter in the `WalletSigner` interface.
 */

import { SignerNotConfiguredError, WalletRejectedError } from "./errors.js";

export interface SignOptions {
  /** The address expected to sign; wallets reject a mismatch. */
  address: string;
  /** Network passphrase the transaction was built for. */
  networkPassphrase: string;
}

/** A replaceable transaction signer. */
export interface WalletSigner {
  /** The address this signer controls. */
  getAddress(): Promise<string>;
  /**
   * Sign a base64 transaction envelope and return the signed envelope.
   * MUST throw (ideally {@link WalletRejectedError}) when the user declines.
   */
  signTransaction(envelopeXdr: string, options: SignOptions): Promise<string>;
}

/**
 * Minimal surface of the `@stellar/freighter-api` module the SDK uses. Kept
 * structural so a caller can inject a compatible object without taking a hard
 * dependency on the package.
 */
export interface FreighterApi {
  isConnected(): Promise<{ isConnected: boolean; error?: { message: string } }>;
  isAllowed(): Promise<{ isAllowed: boolean; error?: { message: string } }>;
  requestAccess(): Promise<{ address?: string; error?: { message: string } }>;
  getAddress(): Promise<{ address?: string; error?: { message: string } }>;
  signTransaction(
    envelopeXdr: string,
    options?: { address?: string; networkPassphrase?: string },
  ): Promise<{ signedTxXdr?: string; error?: { message: string } }>;
}

/**
 * Opaque dynamic import.
 *
 * Constructed with `new Function` so bundlers (webpack, Vite, esbuild) cannot
 * statically analyse it. That is deliberate: `@stellar/freighter-api` is an
 * optional peer dependency that must not be pulled into a bundle unless the
 * caller actually uses {@link FreighterSigner}.
 */
const dynamicImport = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<unknown>;

/** Load `@stellar/freighter-api` lazily at runtime. */
async function loadFreighter(): Promise<FreighterApi> {
  try {
    return (await dynamicImport("@stellar/freighter-api")) as FreighterApi;
  } catch (error) {
    throw new SignerNotConfiguredError(
      "FreighterSigner requires the optional peer dependency @stellar/freighter-api " +
        `to be installed. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/**
 * A {@link WalletSigner} backed by the Freighter browser extension.
 *
 * Pass an already-loaded `api` object to avoid the dynamic import (useful in
 * tests and when the host app already bundles Freighter).
 */
export class FreighterSigner implements WalletSigner {
  private readonly injected?: FreighterApi;

  constructor(api?: FreighterApi) {
    this.injected = api;
  }

  private async api(): Promise<FreighterApi> {
    return this.injected ?? loadFreighter();
  }

  async getAddress(): Promise<string> {
    const api = await this.api();
    const allowed = await api.isAllowed();
    if (!allowed.isAllowed) {
      const access = await api.requestAccess();
      if (access.error) throw new WalletRejectedError(access.error.message);
      if (!access.address) throw new WalletRejectedError("Freighter returned no address.");
      return access.address;
    }
    const result = await api.getAddress();
    if (result.error) throw new WalletRejectedError(result.error.message);
    if (!result.address) throw new WalletRejectedError("Freighter returned no address.");
    return result.address;
  }

  async signTransaction(envelopeXdr: string, options: SignOptions): Promise<string> {
    const api = await this.api();
    const result = await api.signTransaction(envelopeXdr, {
      address: options.address,
      networkPassphrase: options.networkPassphrase,
    });
    if (result.error) throw new WalletRejectedError(result.error.message);
    if (!result.signedTxXdr) throw new WalletRejectedError("Freighter returned no signed transaction.");
    return result.signedTxXdr;
  }
}

/**
 * Wrap a plain `sign(envelopeXdr) => signedXdr` callback as a {@link WalletSigner}.
 * Handy for tests and for host apps whose wallet layer is not Freighter.
 */
export function callbackSigner(
  address: string | (() => Promise<string>),
  sign: (envelopeXdr: string, options: SignOptions) => Promise<string>,
): WalletSigner {
  return {
    async getAddress() {
      return typeof address === "function" ? address() : address;
    },
    signTransaction: (envelopeXdr, options) => sign(envelopeXdr, options),
  };
}
