import { CONFIG } from '../config.js';

/** The slice of a TonAPI NFT item this game cares about. */
export interface NftItem {
  /** NFT item address — used as the card's stable id. */
  address: string;
  name: string;
  /** Best available image URL (a resized preview when TonAPI provides one). */
  image?: string;
  /** metadata.attributes, e.g. [{ trait_type: 'Attack', value: '5' }]. */
  attributes: { trait_type: string; value: string | number }[];
  /** Collection address in raw (0:hex) form and token index — the dedupe key
   *  when the same holding arrives from both TonAPI and TigerMint. */
  collection?: string;
  index?: number;
}

interface TonApiNftItem {
  address: string;
  index?: number;
  collection?: { address?: string };
  metadata?: {
    name?: string;
    image?: string;
    attributes?: { trait_type?: string; value?: string | number }[];
  };
  previews?: { resolution: string; url: string }[];
}

/**
 * Fetch the wallet's NFTs from TonAPI across every configured collection
 * (one request per collection so TonAPI does the filtering; all wallet NFTs
 * when no collection is configured).
 */
export async function fetchNfts(ownerAddress: string): Promise<NftItem[]> {
  const collections = CONFIG.collectionAddresses;
  if (collections.length === 0) return fetchCollectionNfts(ownerAddress);
  const batches = await Promise.all(collections.map((c) => fetchCollectionNfts(ownerAddress, c)));
  return batches.flat();
}

async function fetchCollectionNfts(ownerAddress: string, collection?: string): Promise<NftItem[]> {
  const params = new URLSearchParams({ limit: '100', indirect_ownership: 'false' });
  if (collection) params.set('collection', collection);

  const headers: Record<string, string> = {};
  if (CONFIG.tonapiKey) headers['Authorization'] = `Bearer ${CONFIG.tonapiKey}`;

  const res = await fetch(
    `${CONFIG.tonapiBase}/v2/accounts/${encodeURIComponent(ownerAddress)}/nfts?${params}`,
    { headers }
  );
  if (!res.ok) throw new Error(`TonAPI responded ${res.status}`);
  const data = (await res.json()) as { nft_items?: TonApiNftItem[] };

  return (data.nft_items ?? []).map((item) => {
    // Prefer a mid-size preview over the raw (possibly huge / ipfs://) image.
    const preview =
      item.previews?.find((p) => p.resolution === '500x500')?.url ??
      item.previews?.at(-1)?.url;
    return {
      address: item.address,
      name: item.metadata?.name ?? shortAddress(item.address),
      image: preview ?? normalizeImageUrl(item.metadata?.image),
      attributes: (item.metadata?.attributes ?? [])
        .filter((a): a is { trait_type: string; value: string | number } => !!a.trait_type && a.value !== undefined),
      collection: item.collection?.address ? rawAddress(item.collection.address) : undefined,
      index: item.index,
    };
  });
}

/**
 * Normalize a TON address to raw `wc:hex` form so addresses compare equal
 * regardless of source (TonAPI returns raw, TigerMint returns EQ… friendly).
 */
export function rawAddress(addr: string): string {
  if (/^-?\d+:/.test(addr)) return addr.toLowerCase();
  try {
    // Friendly form: base64url of tag(1) + workchain(1) + hash(32) + crc(2).
    const b64 = addr.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const wc = bytes[1] === 0xff ? -1 : bytes[1];
    const hash = [...bytes.slice(2, 34)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${wc}:${hash}`;
  } catch {
    return addr.toLowerCase();
  }
}

function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice('ipfs://'.length)}`;
  return url;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
