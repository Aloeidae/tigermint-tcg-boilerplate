/**
 * The `overlay` card style's layout model — pure data, no rendering.
 *
 * Overlay cards are full-art images the client composites text over: every
 * card element (name, stats, type, description, skills…) gets an assignable
 * static position, and an optional scrim (a colorable gradient, plain or
 * pattern-filled) sits under the text block to keep it legible on any art.
 *
 * The model lives in shared so layouts travel as data: a default in the
 * client theme, a per-set `layout` block in pack.json (which TigerMint's
 * served manifest transports verbatim), and per-card overrides on CardDef.
 * The client merges those layers with mergeOverlayLayout() and renders in
 * CardSprite; the dev layout editor edits this same shape and exports it.
 */

/** The nine card regions an element can anchor to (same as badge anchors). */
export type OverlayAnchor =
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'middleLeft' | 'center' | 'middleRight'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight';

/** One element's placement + styling. All lengths are fractions: pads and
 *  wrap of card WIDTH, text size of card HEIGHT (badge size of width). */
export interface OverlaySpot {
  anchor: OverlayAnchor;
  /** Padding inward from edges; signed right/down on centered anchors. */
  padX?: number;
  padY?: number;
  /** How to draw: styled text (default) or a gem badge (numeric stats). */
  render?: 'text' | 'badge';
  /** Text: font size / card height. Badge: diameter / card width. */
  size?: number;
  font?: 'display' | 'body' | 'mono';
  /** Text color — or the gem fill for render:'badge'. '#rrggbb'. */
  color?: string;
  stroke?: string;
  /** Stroke width as a fraction of card height (scales with the card). */
  strokeThickness?: number;
  bold?: boolean;
  italic?: boolean;
  /** Uppercase the value (display-font headlines). */
  upper?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Word-wrap width as a fraction of card width (descriptions). */
  wrap?: number;
  maxLines?: number;
  /** Hide when the card renders narrower than this many px (declutters
   *  board-size cards; inspect/reveal sizes show everything). */
  hideBelow?: number;
}

/** The legibility panel behind the text block. */
export interface OverlayScrim {
  /** Which edge it hugs. */
  edge?: 'bottom' | 'top';
  /** Panel height as a fraction of card height. */
  height?: number;
  /** Base color, '#rrggbb'. */
  color?: string;
  /** Opacity at the outer edge (the fade runs toward the card middle). */
  alpha?: number;
  /** Fraction of the panel height that fades out to transparent. */
  fade?: number;
  /** Fill on top of the gradient: procedural tiles, or 'image' for a
   *  public/pack/scrim.png tile. */
  pattern?: 'none' | 'stripes' | 'dots' | 'grid' | 'noise' | 'image';
  patternColor?: string;
  patternAlpha?: number;
  /** Tile scale multiplier. */
  patternScale?: number;
}

/** Everything an overlay layout can place. League-only keys (moves,
 *  swapCost) render nothing on cards without a `game` block. */
export type OverlayElement =
  | 'name' | 'type' | 'cost' | 'attack' | 'health' | 'defense'
  | 'description' | 'skills' | 'rarity' | 'moves' | 'swapCost';

export interface OverlayLayout {
  /** Element placements; explicitly `null` hides an element a lower layer placed. */
  elements?: Partial<Record<OverlayElement, OverlaySpot | null>>;
  /** The scrim; explicitly `null` removes one a lower layer set. */
  scrim?: OverlayScrim | null;
}

/**
 * Merge layout layers, later layers winning: element entries replace whole
 * spots (no per-field merging — a layer that repositions `name` owns it),
 * `null` hides, and the scrim replaces wholesale the same way.
 */
export function mergeOverlayLayout(
  ...layers: (OverlayLayout | null | undefined)[]
): OverlayLayout {
  const out: OverlayLayout = { elements: {} };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.elements) Object.assign(out.elements!, layer.elements);
    if (layer.scrim !== undefined) out.scrim = layer.scrim;
  }
  return out;
}

/** Loose runtime check for untrusted manifest data. */
export function isOverlayLayout(v: unknown): v is OverlayLayout {
  if (!v || typeof v !== 'object') return false;
  const o = v as OverlayLayout;
  if (o.elements !== undefined && (typeof o.elements !== 'object' || o.elements === null)) return false;
  if (o.scrim !== undefined && o.scrim !== null && typeof o.scrim !== 'object') return false;
  return true;
}
