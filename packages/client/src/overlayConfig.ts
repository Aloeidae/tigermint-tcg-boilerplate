import { isOverlayLayout, mergeOverlayLayout, type CardDef, type OverlayLayout } from '@tcg/shared';
import { THEME } from './theme.js';

/**
 * Where the overlay card style's layout comes from, merged in order (later
 * wins): the theme default (THEME.card.overlay) <- the loaded pack's
 * top-level `layout` block <- the card's own `layout` <- the dev layout
 * editor's draft (localStorage, DEV builds only). See shared/src/overlay.ts
 * for the model and objects/CardSprite.ts for the renderer.
 */

let packLayout: OverlayLayout | null = null;
let draft: OverlayLayout | null = null;
let draftLoaded = false;

const DRAFT_KEY = 'tm-layout-draft';

/** Called by the pack loader with the manifest's `layout` block, if any. */
export function setPackOverlayLayout(layout: unknown): void {
  packLayout = isOverlayLayout(layout) ? layout : null;
}

export function getPackOverlayLayout(): OverlayLayout | null {
  return packLayout;
}

/** The layout editor's work-in-progress (DEV only, per browser). */
export function getDraftOverlayLayout(): OverlayLayout | null {
  if (!import.meta.env.DEV) return null;
  if (!draftLoaded) {
    draftLoaded = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      draft = parsed && isOverlayLayout(parsed) ? parsed : null;
    } catch {
      draft = null;
    }
  }
  return draft;
}

export function setDraftOverlayLayout(layout: OverlayLayout | null): void {
  draft = layout;
  draftLoaded = true;
  try {
    if (layout) localStorage.setItem(DRAFT_KEY, JSON.stringify(layout));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable — the in-memory draft still applies this session
  }
}

/** The effective layout for one card. */
export function mergedOverlay(def: CardDef): OverlayLayout {
  return mergeOverlayLayout(THEME.card.overlay, packLayout, def.layout, getDraftOverlayLayout());
}
