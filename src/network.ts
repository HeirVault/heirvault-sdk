/**
 * Network configuration.
 *
 * The SDK is deliberately free of any coupling to `process.env`, Next.js or a
 * particular endpoint provider: a caller passes either a known network id or a
 * fully-specified {@link NetworkConfig}. The canonical network passphrases are
 * public protocol constants (required to build a valid transaction) and are
 * therefore safe to embed.
 */

/** Networks the SDK ships sensible defaults for. */
export const NETWORK_IDS = ["testnet", "mainnet", "futurenet", "standalone"] as const;

export type NetworkId = (typeof NETWORK_IDS)[number];

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  /** Soroban RPC endpoint used to simulate and submit transactions. */
  rpcUrl: string;
  /** Horizon endpoint (account/balance reads, explorer helpers). */
  horizonUrl: string;
  /** Network passphrase required when building/signing transactions. */
  passphrase: string;
  /** Base URL of the block explorer for this network. */
  explorerBaseUrl: string;
  /** `true` for Stellar Mainnet (real funds). */
  isMainnet: boolean;
}

/** Canonical Stellar network passphrases. Public protocol constants. */
export const NETWORK_PASSPHRASES: Readonly<Record<NetworkId, string>> = Object.freeze({
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
  standalone: "Standalone Network ; February 2017",
});

const DEFAULT_RPC_URLS: Readonly<Record<NetworkId, string>> = Object.freeze({
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
  futurenet: "https://rpc-futurenet.stellar.org",
  standalone: "http://localhost:8000/soroban/rpc",
});

const DEFAULT_HORIZON_URLS: Readonly<Record<NetworkId, string>> = Object.freeze({
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
  standalone: "http://localhost:8000",
});

const DEFAULT_EXPLORER_BASE_URLS: Readonly<Record<NetworkId, string>> = Object.freeze({
  testnet: "https://stellar.expert/explorer/testnet",
  mainnet: "https://stellar.expert/explorer/public",
  futurenet: "https://stellar.expert/explorer/futurenet",
  standalone: "",
});

const NETWORK_LABELS: Readonly<Record<NetworkId, string>> = Object.freeze({
  testnet: "Stellar Testnet",
  mainnet: "Stellar Mainnet",
  futurenet: "Stellar Futurenet",
  standalone: "Local / Standalone",
});

/** `true` when `value` is one of the known network ids. */
export function isNetworkId(value: string): value is NetworkId {
  return (NETWORK_IDS as readonly string[]).includes(value);
}

/** Build the default configuration for a known network id. */
export function networkConfig(id: NetworkId): NetworkConfig {
  return {
    id,
    label: NETWORK_LABELS[id],
    rpcUrl: DEFAULT_RPC_URLS[id],
    horizonUrl: DEFAULT_HORIZON_URLS[id],
    passphrase: NETWORK_PASSPHRASES[id],
    explorerBaseUrl: DEFAULT_EXPLORER_BASE_URLS[id],
    isMainnet: id === "mainnet",
  };
}

/** Fields a caller may override when supplying a custom network config. */
export type NetworkConfigInput = NetworkId | (Partial<Omit<NetworkConfig, "id">> & { id: NetworkId });

/** The default network used when a caller omits one: Testnet. */
export const DEFAULT_NETWORK_ID: NetworkId = "testnet";

/**
 * Resolve a {@link NetworkConfigInput} into a complete {@link NetworkConfig}.
 *
 * A bare network id yields the canonical defaults. A partial object is merged
 * over those defaults, so a caller only has to specify what differs.
 */
export function resolveNetwork(input?: NetworkConfigInput): NetworkConfig {
  if (!input) return networkConfig(DEFAULT_NETWORK_ID);
  if (typeof input === "string") return networkConfig(input);
  const base = networkConfig(input.id);
  return {
    ...base,
    ...input,
    passphrase: input.passphrase ?? base.passphrase,
    rpcUrl: input.rpcUrl ?? base.rpcUrl,
    horizonUrl: input.horizonUrl ?? base.horizonUrl,
    explorerBaseUrl: input.explorerBaseUrl ?? base.explorerBaseUrl,
    label: input.label ?? base.label,
    isMainnet: input.id === "mainnet",
  };
}
