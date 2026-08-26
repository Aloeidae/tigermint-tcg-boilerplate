/**
 * Client configuration. Every value can be overridden with a Vite env var
 * (create packages/client/.env.local, e.g. VITE_NFT_COLLECTION=EQ...).
 */

/** Comma-separated env value -> trimmed list ("a, b," -> ["a","b"]). */
function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const CONFIG = {
  /**
   * The TON NFT collection(s) your game's cards come from — comma-separated
   * for multiple packs/booster sets. Leave empty to use ALL NFTs in the
   * connected wallet (handy for testing).
   */
  collectionAddresses: parseList(import.meta.env.VITE_NFT_COLLECTION as string | undefined),

  /**
   * How NFT cards render, unless an NFT's own "Card Style" attribute says
   * otherwise. 'framed': the system draws the card frame and the NFT image
   * fills the art window. 'fullart': the NFT image IS the card — for
   * collections whose art is a complete card design (name, stats and skills
   * painted into the art; skills must then come from metadata).
   */
  cardStyle: /full/i.test((import.meta.env.VITE_CARD_STYLE as string | undefined) ?? '')
    ? ('fullart' as const)
    : ('framed' as const),

  /**
   * Where the menu's "mint your own cards" link points. TigerMint is the
   * recommended launchpad: its blind mints play like booster packs, a natural
   * fit for card collections. Set empty ("") to hide the link.
   */
  // The Pro Wizard's card-set template preconfigures import mode and the
  // CSV template for per-card attribute manifests like pack.json.
  mintUrl:
    (import.meta.env.VITE_MINT_URL as string | undefined) ??
    'https://mint.tendytiger.lol/project/submit?template=cards',

  /**
   * TigerMint pull integration (the hideable "Pull a card" panel on the
   * menu). Set both to enable it: your collection slug(s) — comma-separated
   * for multiple booster packs, switchable with the panel's arrows — and an
   * API key from https://mint.tendytiger.lol/developers with mint access
   * granted to each drop. Leave empty to hide the panel entirely.
   */
  tigermintSlugs: parseList(import.meta.env.VITE_TIGERMINT_SLUG as string | undefined),
  tigermintApiKey: (import.meta.env.VITE_TIGERMINT_API_KEY as string | undefined) ?? '',
  tigermintApiBase:
    (import.meta.env.VITE_TIGERMINT_API_BASE as string | undefined) ?? 'https://mint.tendytiger.lol',
  /**
   * Whether the pull panel starts shown or hidden ('shown' | 'hidden').
   * A player's own hide/show choice (localStorage) always wins after that.
   */
  pullPanelDefault: /hidden/i.test((import.meta.env.VITE_PULL_PANEL as string | undefined) ?? '')
    ? ('hidden' as const)
    : ('shown' as const),

  /** TonAPI base URL. Add an API key via VITE_TONAPI_KEY for production traffic. */
  tonapiBase: (import.meta.env.VITE_TONAPI_BASE as string | undefined) ?? 'https://tonapi.io',
  tonapiKey: (import.meta.env.VITE_TONAPI_KEY as string | undefined) ?? '',

  /** WebSocket URL of the PvP server (packages/server). */
  serverUrl: (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:8081',

  /**
   * Telegram Mini App deep link (https://t.me/yourbot/yourapp). When set,
   * TON wallets return to the Mini App after signing instead of stranding
   * the player in the wallet app. Only relevant when shipping inside
   * Telegram — see src/tma.ts.
   */
  twaReturnUrl: (import.meta.env.VITE_TWA_RETURN_URL as string | undefined) ?? '',

  /**
   * TonConnect manifest URL. Wallets fetch this server-side, so it MUST be a
   * public HTTPS URL — a localhost manifest can never work. The default
   * points at this repo's manifest on GitHub raw (fine for dev); set
   * VITE_TONCONNECT_MANIFEST to a manifest describing YOUR app when you
   * fork or deploy.
   */
  manifestUrl:
    (import.meta.env.VITE_TONCONNECT_MANIFEST as string | undefined) ??
    'https://raw.githubusercontent.com/Aloeidae/tigermint-tcg-boilerplate/main/packages/client/public/tonconnect-manifest.json',
};
