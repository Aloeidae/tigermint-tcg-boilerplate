import { CONFIG } from '../config.js';
import { rawAddress, type NftItem } from './nfts.js';

/**
 * TigerMint pull integration — lets players blind-pull a card from your
 * TigerMint collection without leaving the game (the "MINT FROM YOUR APP"
 * flow from https://mint.tendytiger.lol/developers).
 *
 * Setup: launch your collection on TigerMint, create an API key on the
 * /developers page, grant it mint access from the collection dashboard's
 * settings tab, then set VITE_TIGERMINT_SLUG and VITE_TIGERMINT_API_KEY.
 * Comma-separate several slugs for multiple booster packs — the panel's
 * arrows page between them (grant the key mint access to each drop).
 * The key is rate-limited and scoped to minting your drops; every phase,
 * price and wallet cap is still enforced server-side.
 */

export interface MintTerms {
  phase?: {
    type?: string;
    status?: string;
    price_nano?: string;
    network_fee_nano?: string;
    total_per_item_nano?: string;
    max_per_wallet?: number;
  };
  supply?: { total?: number; minted?: number; remaining?: number };
  wallet?: { eligible?: boolean; reason?: string; remaining?: number } | null;
  max_pull_count?: number;
  currency?: string;
  [key: string]: unknown;
}

/**
 * Pull prices are denominated in GRAM. The label is deliberately NOT
 * configurable — it reads from TigerMint's mint-terms when provided and
 * falls back to GRAM, so a fork can't quietly relabel what players pay.
 */
export function pullCurrency(terms?: MintTerms): string {
  return String(terms?.currency ?? 'GRAM');
}

const fromNano = (nano?: string): string | undefined => {
  if (!nano) return undefined;
  const value = Number(nano) / 1e9;
  return Number.isFinite(value) ? String(parseFloat(value.toFixed(4))) : undefined;
};

/** The mint-terms fields the UI shows, flattened from the API's shape. */
export function parseMintTerms(t: MintTerms): {
  /** What the wallet is actually charged per pull (fees included). */
  price?: string;
  phase?: string;
  live?: boolean;
  eligible?: boolean;
  reason?: string;
  minted?: number;
  total?: number;
  /** The largest multi-pull this drop/wallet allows right now. */
  maxPull: number;
} {
  const remaining = t.supply?.remaining;
  const walletRemaining = t.wallet?.remaining;
  let maxPull = t.max_pull_count ?? 10;
  if (remaining !== undefined) maxPull = Math.min(maxPull, remaining);
  if (walletRemaining !== undefined) maxPull = Math.min(maxPull, walletRemaining);
  return {
    price: fromNano(t.phase?.total_per_item_nano) ?? fromNano(t.phase?.price_nano),
    phase: t.phase?.type,
    live: t.phase?.status === 'ACTIVE',
    eligible: t.wallet?.eligible,
    reason: t.wallet?.reason,
    minted: t.supply?.minted,
    total: t.supply?.total,
    maxPull: Math.max(1, maxPull),
  };
}

export interface MintVoucher {
  voucher: { startIndex: number; items?: unknown[] };
  message: { to: string; amount: string; payloadBase64: string; validUntil: number };
}

const base = () => CONFIG.tigermintApiBase.replace(/\/$/, '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CONFIG.tigermintApiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const data = (await res.json()) as { success: boolean; response?: T; error?: unknown };
  if (!data.success) throw new Error(apiErrorMessage(data.error, res.status));
  return data.response as T;
}

/** v1 errors are { message, code } objects; older shapes may be strings. */
function apiErrorMessage(error: unknown, status: number): string {
  if (typeof error === 'string' && error) return error;
  const msg = (error as { message?: string } | null)?.message;
  return msg || `TigerMint API ${status}`;
}

export function pullConfigured(): boolean {
  return Boolean(CONFIG.tigermintSlugs.length > 0 && CONFIG.tigermintApiKey);
}

export interface CollectionInfo {
  name?: string;
  description?: string;
  /** Collection contract address (EQ… friendly form). */
  address?: string;
  coverImage?: string;
  cover_image?: string;
  cover?: string;
  image?: string;
  totalSupply?: number;
  total_supply?: number;
  minted?: number;
  [key: string]: unknown;
}

/** A collection by slug: name, description, cover, supply. */
export function getCollection(slug: string): Promise<CollectionInfo> {
  return api<CollectionInfo>(`/api/v1/collections/${slug}`);
}

/** Live mint terms; pass the wallet for per-wallet eligibility and caps. */
export function getMintTerms(slug: string, wallet?: string): Promise<MintTerms> {
  const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
  return api<MintTerms>(`/api/v1/collections/${slug}/mint-terms${q}`);
}

/** A signed pull plus a ready-to-send TonConnect message. */
export function getMintVoucher(
  slug: string,
  walletAddress: string,
  pullCount = 1
): Promise<MintVoucher> {
  return api<MintVoucher>(`/api/v1/collections/${slug}/mint-voucher`, {
    method: 'POST',
    body: JSON.stringify({ walletAddress, pullCount }),
  });
}

/** Item indices this wallet holds in the given collection. */
export async function walletIndices(walletAddress: string, slug: string): Promise<Set<number>> {
  const data = await api<{ items?: WalletNftItem[] } | WalletNftItem[]>(
    `/api/v1/wallets/${encodeURIComponent(walletAddress)}/nfts`
  );
  const list = Array.isArray(data) ? data : (data.items ?? []);
  const indices = new Set<number>();
  for (const item of list) {
    // Live shape: { collection_slug, token_index, acquired_at }.
    const index = item.token_index ?? item.index;
    if (index === undefined) continue;
    const itemSlug = item.collection_slug ?? item.collection?.slug;
    if (itemSlug && itemSlug !== slug) continue;
    indices.add(index);
  }
  return indices;
}

interface WalletNftItem {
  collection_slug?: string;
  token_index?: number;
  collection?: { slug?: string };
  index?: number;
}

/**
 * The authoritative metadata for one minted token — the same JSON wallets
 * read via the chain's metadata URI. Reveals MUST use this route, never the
 * /items listing: /items serves the distinct card set in a deliberately
 * shuffled display order (so a blind mint can't be sniped by reading which
 * token index holds a rare) and only suits gallery/binder views. Unminted
 * indices stay sealed here.
 */
export interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: { trait_type?: string; value?: string | number }[];
}

export async function getTokenMetadata(slug: string, index: number): Promise<TokenMetadata | null> {
  const res = await fetch(`${base()}/api/nft/${encodeURIComponent(slug)}/${index}?fresh=1`);
  if (!res.ok) return null;
  return (await res.json()) as TokenMetadata;
}

/**
 * Fresh pulls this browser watched land, remembered so the deck updates the
 * moment a pull finishes — TigerMint's holdings mirror (confirm write +
 * reconciler cron) can trail the mint by minutes, and the game shouldn't
 * wait on it for indices it saw itself. Entries self-prune once the mirror
 * catches up.
 */
const pulledKey = (slug: string): string => `tm-pulled-${slug}`;

export function rememberPulled(slug: string, indices: number[]): void {
  try {
    const cur = new Set<number>(JSON.parse(localStorage.getItem(pulledKey(slug)) ?? '[]') as number[]);
    for (const i of indices) cur.add(i);
    localStorage.setItem(pulledKey(slug), JSON.stringify([...cur]));
  } catch {
    // storage unavailable — the mirror will catch up on its own
  }
}

function recallPulled(slug: string): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(pulledKey(slug)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/**
 * The wallet's cards straight from TigerMint: held token indices per
 * configured slug — the holdings mirror MERGED with pulls this browser just
 * watched land — each hydrated from its authoritative metadata. This is
 * what keeps freshly pulled cards playable instantly, while public chain
 * indexers (TonAPI) and the holdings mirror lag behind the mint. Merge it
 * with the TonAPI fetch, deduped by collection + token index.
 */
export async function tigermintNfts(walletAddress: string): Promise<NftItem[]> {
  if (!pullConfigured()) return [];
  const perSlug = await Promise.all(
    CONFIG.tigermintSlugs.map(async (slug) => {
      const [indices, info] = await Promise.all([
        walletIndices(walletAddress, slug),
        getCollection(slug).catch(() => null),
      ]);
      // Merge locally remembered pulls; drop the note once the mirror has them.
      const remembered = recallPulled(slug);
      if (remembered.length > 0) {
        if (remembered.every((i) => indices.has(i))) {
          try {
            localStorage.removeItem(pulledKey(slug));
          } catch {
            // fine
          }
        } else {
          for (const i of remembered) indices.add(i);
        }
      }
      const collection = info?.address ? rawAddress(String(info.address)) : undefined;
      const items = await Promise.all(
        [...indices].sort((a, b) => a - b).map(async (index): Promise<NftItem | null> => {
          const meta = await getTokenMetadata(slug, index).catch(() => null);
          if (!meta) return null;
          return {
            address: `${slug}:${index}`,
            name: meta.name ?? `#${index}`,
            image: meta.image,
            attributes: (meta.attributes ?? []).filter(
              (a): a is { trait_type: string; value: string | number } =>
                !!a.trait_type && a.value !== undefined
            ),
            collection,
            index,
          };
        })
      );
      return items.filter((i): i is NftItem => i !== null);
    })
  );
  return perSlug.flat();
}

/**
 * Record the landed mint into TigerMint's feed, holdings and binder. This is
 * what makes the card show up there INSTANTLY — the chain reconciler behind
 * the wallets endpoint is eventually-consistent — so it retries a few times
 * (idempotent per index). The pull itself is on-chain either way, so final
 * failure is still non-fatal.
 */
export async function confirmMint(
  slug: string,
  walletAddress: string,
  count: number,
  txHash: string,
  indices: number[]
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await api(`/api/v1/collections/${slug}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ walletAddress, count, txHash, indices }),
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
}

/** Hex sha-256 of the returned transaction BOC, used as a best-effort tx id. */
export async function bocHash(bocBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(bocBase64), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
