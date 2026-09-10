import Phaser from 'phaser';
import {
  buildDemoDeck,
  isOverlayLayout,
  mergeOverlayLayout,
  POCKET_DEMO_CARDS,
  type CardDef,
  type OverlayElement,
  type OverlayLayout,
  type OverlayScrim,
  type OverlaySpot,
} from '@tcg/shared';
import { CardSprite, overlaySpotPos } from '../objects/CardSprite.js';
import { THEME } from '../theme.js';
import {
  getDraftOverlayLayout,
  getPackOverlayLayout,
  setDraftOverlayLayout,
} from '../overlayConfig.js';
import { H, HAND_CARD, PORTRAIT, ROW_CARD, W } from '../layout.js';

/**
 * Dev-only layout editor for the `overlay` card style. One big card with a
 * drag handle per placed element — elements follow the cursor LIVE, the nine
 * anchor bands light up under the pointer, and drops snap to the nearest
 * anchor with back-computed pads. Arrow keys nudge the selected element
 * (Shift = coarse), Ctrl+Z undoes, and hand/board-size previews show what
 * `hideBelow` declutters at real in-game sizes. The side panel drives every
 * OverlaySpot/scrim field (sliders update live); the work-in-progress
 * persists as a localStorage draft that applies everywhere in DEV
 * (overlayConfig.mergedOverlay). **Copy JSON** exports the finished `layout`
 * block for pack.json or THEME.card.overlay; **Paste** imports one back.
 * Reached from the menu's 🎨 button (DEV builds only).
 */

const ELEMENTS: OverlayElement[] = [
  'name', 'type', 'cost', 'attack', 'health', 'defense',
  'description', 'skills', 'rarity', 'moves', 'swapCost',
];

/** Fresh spot for an element being turned on with no prior placement. */
const BLANK_SPOT: OverlaySpot = { anchor: 'center', padX: 0, padY: 0, size: 0.04 };

/** Pad step used by drops, nudges, and the panel sliders. */
const STEP = 0.005;

export class LayoutScene extends Phaser.Scene {
  private pool: CardDef[] = [];
  private index = 0;
  private card: CardSprite | null = null;
  private previews: Phaser.GameObjects.GameObject[] = [];
  private handles: Phaser.GameObjects.Container[] = [];
  private handleDots = new Map<OverlayElement, Phaser.GameObjects.Arc>();
  private guides: Phaser.GameObjects.Graphics | null = null;
  private panel: HTMLDivElement | null = null;
  private selected: OverlayElement | null = null;
  private draft!: OverlayLayout;
  /** The layout WITHOUT the draft — what per-element reset restores. */
  private base!: OverlayLayout;
  private undoStack: OverlayLayout[] = [];
  private lastLive = 0;
  /** A slider gesture is in flight — its undo snapshot is already taken. */
  private sliding = false;

  private cardX = 0;
  private cardY = 0;
  private cardW = 0;
  private cardH = 0;

  constructor() {
    super('Layout');
  }

  init(data: { pool?: CardDef[] }): void {
    this.pool = data.pool?.length ? data.pool : [...buildDemoDeck().slice(0, 10), ...POCKET_DEMO_CARDS];
    this.index = 0;
    this.selected = null;
    this.undoStack = [];
  }

  create(): void {
    this.add.rectangle(W / 2, H / 2, W, H, 0x050505);
    this.cardW = PORTRAIT ? 480 : 460;
    this.cardH = this.cardW * (4 / 3);
    this.cardX = PORTRAIT ? W / 2 : W * 0.3;
    this.cardY = PORTRAIT ? H * 0.36 : H * 0.52;

    this.add
      .text(this.cardX, this.cardY - this.cardH / 2 - 46, '🎨 CARD LAYOUT (DEV)', {
        fontFamily: THEME.fonts.display, fontSize: '30px', color: THEME.menu.title,
      })
      .setOrigin(0.5);
    this.add
      .text(this.cardX, this.cardY + this.cardH / 2 + 30, 'drag to place · arrow keys nudge (Shift = coarse) · Ctrl+Z undo', {
        fontFamily: THEME.fonts.body, fontSize: '16px', color: THEME.hud.bannerIdle,
      })
      .setOrigin(0.5);

    this.base = structuredClone(mergeOverlayLayout(THEME.card.overlay, getPackOverlayLayout()));
    // Editing starts from whatever currently applies (draft included).
    this.draft = structuredClone(mergeOverlayLayout(this.base, getDraftOverlayLayout()));

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    this.buildPanel();
    this.rebuild();
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyPanel());
  }

  // ------------------------------------------------------------------ card

  private currentDef(): CardDef {
    // The editor always previews in overlay style; per-card overrides are
    // stripped so the shared layout is what's being edited.
    const def = { ...this.pool[this.index % this.pool.length] };
    def.style = 'overlay';
    delete def.layout;
    return def;
  }

  /** Rebuild the rendered card + size previews only — handles survive, so
   *  this is safe mid-drag and mid-slider for live feedback. */
  private rebuildCard(): void {
    this.card?.destroy();
    for (const p of this.previews) p.destroy();
    this.previews = [];
    const def = this.currentDef();
    // The draft must be live for CardSprite's mergedOverlay to see edits
    // that haven't been committed yet (drags and slider moves in flight).
    setDraftOverlayLayout(this.draft);
    this.card = new CardSprite(this, this.cardX, this.cardY, this.cardW, this.cardH, def);

    // In-game size previews: what a hand fan and a board row actually show
    // (hideBelow thresholds included). Landscape only — portrait has no room.
    if (!PORTRAIT) {
      const px = this.cardX + this.cardW / 2 + 180;
      const sizes = [
        { label: `hand · ${HAND_CARD.w}px`, w: HAND_CARD.w, h: HAND_CARD.h, y: this.cardY - this.cardH / 2 + HAND_CARD.h / 2 + 14 },
        { label: `board · ${ROW_CARD.w}px`, w: ROW_CARD.w, h: ROW_CARD.h, y: this.cardY + this.cardH / 2 - ROW_CARD.h / 2 - 14 },
      ];
      for (const s of sizes) {
        this.previews.push(new CardSprite(this, px, s.y, s.w, s.h, def));
        this.previews.push(
          this.add
            .text(px, s.y + s.h / 2 + 16, s.label, {
              fontFamily: THEME.fonts.mono, fontSize: '13px', color: THEME.hud.bannerIdle,
            })
            .setOrigin(0.5)
        );
      }
    }
  }

  /** Full rebuild: card, previews, drag handles, and the panel. */
  private rebuild(): void {
    for (const handle of this.handles) handle.destroy();
    this.handles = [];
    this.handleDots.clear();
    this.rebuildCard();
    for (const key of ELEMENTS) {
      const spot = this.draft.elements?.[key];
      if (!spot) continue;
      this.handles.push(this.makeHandle(key, spot));
    }
    this.refreshPanel();
  }

  /** Change the selection WITHOUT rebuilding — a rebuild mid-pointerdown
   *  would destroy the very handle a drag is starting on. */
  private select(key: OverlayElement): void {
    this.selected = key;
    for (const [k, dot] of this.handleDots) {
      const on = k === key;
      dot.setFillStyle(on ? THEME.fx.glowPlayable : 0x1f2937, 0.92);
      dot.setStrokeStyle(2, on ? 0xffffff : THEME.fx.glowPlayable, 0.9);
    }
    this.refreshPanel();
  }

  private save(): void {
    setDraftOverlayLayout(structuredClone(this.draft));
  }

  private pushUndo(): void {
    this.undoStack.push(structuredClone(this.draft));
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.toast('Nothing to undo');
      return;
    }
    this.draft = prev;
    this.save();
    this.rebuild();
  }

  // ------------------------------------------------------------ interaction

  private onKey(e: KeyboardEvent): void {
    // Never steal keys from the panel's inputs.
    const tag = (document.activeElement?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    const key = this.selected;
    const spot = key ? this.draft.elements?.[key] : null;
    if (!key || !spot) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    // Pads push inward from their anchored edge, so the on-screen direction
    // of +padX/+padY depends on the anchor — convert to screen deltas.
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    const sx = spot.anchor.endsWith('Right') ? -1 : 1;
    const sy = spot.anchor.startsWith('bottom') ? -1 : 1;
    this.pushUndo();
    this.mutateSpot(key, {
      padX: round((spot.padX ?? 0) + dx * sx),
      padY: round((spot.padY ?? 0) + dy * sy),
    });
    this.save();
    this.rebuild();
  }

  private mutateSpot(key: OverlayElement, patch: Partial<OverlaySpot>): void {
    const prev = this.draft.elements?.[key] ?? BLANK_SPOT;
    this.draft.elements = { ...this.draft.elements, [key]: { ...prev, ...patch } };
  }

  private makeHandle(key: OverlayElement, spot: OverlaySpot): Phaser.GameObjects.Container {
    const pos = overlaySpotPos(this.cardW, this.cardH, spot);
    const x = this.cardX + pos.x + (0.5 - pos.ox) * 8;
    const y = this.cardY + pos.y + (0.5 - pos.oy) * 8;
    const selected = this.selected === key;
    const c = this.add.container(x, y);
    const dot = this.add
      .circle(0, 0, 11, selected ? THEME.fx.glowPlayable : 0x1f2937, 0.92)
      .setStrokeStyle(2, selected ? 0xffffff : THEME.fx.glowPlayable, 0.9);
    const label = this.add
      .text(0, -24, key, {
        fontFamily: THEME.fonts.mono, fontSize: '13px', color: '#ffffff',
        backgroundColor: '#000000cc', padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5);
    c.add([dot, label]);
    // Auto hit-area from the size — container hit rects are origin-offset,
    // so a hand-built centered Rectangle misses by half its extent.
    c.setSize(30, 30);
    c.setInteractive({ useHandCursor: true });
    this.input.setDraggable(c);
    this.handleDots.set(key, dot);
    c.on('pointerdown', () => this.select(key));
    c.on('dragstart', () => this.pushUndo());
    c.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      c.setPosition(dragX, dragY);
      const lx = dragX - this.cardX;
      const ly = dragY - this.cardY;
      this.drawGuides(lx, ly);
      // Live preview, throttled: the element itself follows the cursor.
      const now = performance.now();
      if (now - this.lastLive > 40) {
        this.lastLive = now;
        this.mutateSpot(key, this.spotFromPoint(lx, ly));
        this.rebuildCard();
      }
    });
    c.on('dragend', () => {
      this.clearGuides();
      this.placeAt(key, c.x - this.cardX, c.y - this.cardY);
    });
    return c;
  }

  /** Card-local point -> snapped anchor + pads (drops, nudges, live drags). */
  private spotFromPoint(x: number, y: number): Pick<OverlaySpot, 'anchor' | 'padX' | 'padY'> {
    const w = this.cardW;
    const h = this.cardH;
    const col = x < -w / 6 ? 'Left' : x > w / 6 ? 'Right' : 'Center';
    const rowBand = y < -h / 6 ? 'top' : y > h / 6 ? 'bottom' : 'middle';
    const anchor = (
      rowBand === 'middle' && col === 'Center' ? 'center' : `${rowBand}${col}`
    ) as OverlaySpot['anchor'];
    const padX = col === 'Left' ? round((x + w / 2) / w) : col === 'Right' ? round((w / 2 - x) / w) : round(x / w);
    const padY = rowBand === 'top' ? round((y + h / 2) / w) : rowBand === 'bottom' ? round((h / 2 - y) / w) : round(y / w);
    return { anchor, padX, padY };
  }

  private placeAt(key: OverlayElement, x: number, y: number): void {
    this.mutateSpot(key, this.spotFromPoint(x, y));
    this.selected = key;
    this.save();
    this.rebuild();
  }

  /** The nine anchor bands, with the one under the pointer lit up. */
  private drawGuides(x: number, y: number): void {
    if (!this.guides) this.guides = this.add.graphics().setDepth(50);
    const g = this.guides;
    const w = this.cardW;
    const h = this.cardH;
    const left = this.cardX - w / 2;
    const top = this.cardY - h / 2;
    g.clear();
    // Active band fill.
    const col = x < -w / 6 ? 0 : x > w / 6 ? 2 : 1;
    const rowBand = y < -h / 6 ? 0 : y > h / 6 ? 2 : 1;
    g.fillStyle(THEME.fx.glowPlayable, 0.14);
    g.fillRect(left + (col * w) / 3, top + (rowBand * h) / 3, w / 3, h / 3);
    // Thirds grid.
    g.lineStyle(1, THEME.fx.glowPlayable, 0.45);
    for (let i = 1; i < 3; i++) {
      g.lineBetween(left + (i * w) / 3, top, left + (i * w) / 3, top + h);
      g.lineBetween(left, top + (i * h) / 3, left + w, top + (i * h) / 3);
    }
    g.strokeRect(left, top, w, h);
  }

  private clearGuides(): void {
    this.guides?.clear();
  }

  // ----------------------------------------------------------------- panel

  private destroyPanel(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private buildPanel(): void {
    this.destroyPanel();
    const panel = document.createElement('div');
    this.panel = panel;
    panel.id = 'layout-panel';
    panel.style.cssText = [
      'position:fixed', PORTRAIT ? 'left:0;right:0;bottom:0;max-height:44vh' : 'top:0;right:0;bottom:0;width:330px',
      'overflow-y:auto', 'background:#0d0d0dee', 'border-left:1px solid rgba(255,255,255,.1)',
      'padding:14px 16px', 'z-index:60', 'font-family:Inter,sans-serif', 'font-size:13px',
      'color:#c7c7c7', 'backdrop-filter:blur(4px)',
    ].join(';');
    document.body.appendChild(panel);
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.innerHTML = '';
    const h = (tag: string, text?: string, css?: string): HTMLElement => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (css) el.style.cssText = css;
      panel.appendChild(el);
      return el;
    };
    const heading = 'margin:12px 0 6px;color:#f97316;font-family:"Lilita One",sans-serif;font-size:15px;letter-spacing:.5px';
    const btnCss =
      'margin:4px 6px 4px 0;padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#1f1f1f;color:#fff;cursor:pointer;font-size:13px';

    // --- card cycler + top actions ---
    const bar = h('div', undefined, 'display:flex;align-items:center;gap:6px;flex-wrap:wrap');
    const mkBtn = (label: string, title: string, onClick: () => void, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = btnCss + (primary ? ';background:#f97316;color:#000;border-color:#ea580c;font-weight:700' : '');
      b.onclick = onClick;
      bar.appendChild(b);
      return b;
    };
    mkBtn('‹', 'Previous card', () => {
      this.index = (this.index + this.pool.length - 1) % this.pool.length;
      this.rebuild();
    });
    const cardName = this.currentDef().name;
    bar.appendChild(
      Object.assign(document.createElement('span'), {
        textContent: `${(this.index % this.pool.length) + 1}/${this.pool.length} ${cardName.length > 14 ? `${cardName.slice(0, 13)}…` : cardName}`,
        style: 'white-space:nowrap',
      })
    );
    mkBtn('›', 'Next card', () => {
      this.index = (this.index + 1) % this.pool.length;
      this.rebuild();
    });
    mkBtn('📋 Copy', 'Copy the layout JSON for pack.json / THEME.card.overlay', () => void this.copyJson(), true);
    mkBtn('📥 Paste', 'Import a layout JSON from the clipboard', () => void this.pasteJson());
    mkBtn('↶ Undo', 'Undo the last change (Ctrl+Z)', () => this.undo());
    mkBtn('↺ Reset', 'Discard the draft — back to the theme/pack layout', () => {
      this.pushUndo();
      setDraftOverlayLayout(null);
      this.draft = structuredClone(this.base);
      this.rebuild();
    });
    mkBtn('← Menu', 'Back to the menu (the draft stays saved)', () => {
      this.destroyPanel();
      this.scene.start('Menu');
    });

    // --- element picker ---
    h('div', 'ELEMENT', heading);
    const picker = document.createElement('select');
    picker.style.cssText = 'width:100%;padding:6px;background:#1f1f1f;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:6px';
    for (const key of ELEMENTS) {
      const opt = document.createElement('option');
      opt.value = key;
      const placed = !!this.draft.elements?.[key];
      opt.textContent = `${placed ? '● ' : '○ '}${key}`;
      picker.appendChild(opt);
    }
    picker.value = this.selected ?? 'name';
    if (!this.selected) this.selected = picker.value as OverlayElement;
    picker.onchange = () => {
      this.select(picker.value as OverlayElement);
    };
    panel.appendChild(picker);

    const key = this.selected!;
    const spot = this.draft.elements?.[key] ?? null;
    const setSpot = (patch: Partial<OverlaySpot> | null): void => {
      this.pushUndo();
      this.draft.elements = { ...this.draft.elements, [key]: patch === null ? null : { ...(spot ?? BLANK_SPOT), ...patch } };
      this.save();
      this.rebuild();
    };
    /** Slider path: live while sliding (card only), committed on release. */
    const liveSpot = (patch: Partial<OverlaySpot>, commit: boolean): void => {
      if (commit) {
        this.sliding = false;
        this.save();
        this.rebuild();
        return;
      }
      if (!this.sliding) {
        this.sliding = true;
        this.pushUndo();
      }
      this.mutateSpot(key, patch);
      this.rebuildCard();
    };

    const row = (label: string, input: HTMLElement): void => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0';
      const l = document.createElement('span');
      l.textContent = label;
      l.style.cssText = 'flex:0 0 84px;color:#9ca3af';
      div.append(l, input);
      panel.appendChild(div);
    };
    const inputCss = 'flex:1;min-width:0;padding:5px;background:#1f1f1f;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:6px;font-size:13px';
    const numIn = (value: number | undefined, step: number, onSet: (v: number | undefined) => void): HTMLInputElement => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = String(step);
      i.value = value !== undefined ? String(value) : '';
      i.style.cssText = inputCss;
      i.onchange = () => onSet(i.value === '' ? undefined : Number(i.value));
      return i;
    };
    /** Range slider + live readout. `onLive(v, commit)`: commit=false while
     *  sliding (throttle-friendly), true once on release. */
    const slideIn = (
      value: number | undefined,
      min: number,
      max: number,
      step: number,
      fallback: number,
      onLive: (v: number, commit: boolean) => void
    ): HTMLElement => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:6px;min-width:0';
      const i = document.createElement('input');
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(value ?? fallback);
      i.style.cssText = 'flex:1;min-width:0;accent-color:#f97316';
      const out = document.createElement('span');
      out.textContent = String(value ?? fallback);
      out.style.cssText = 'flex:0 0 44px;text-align:right;font-family:"JetBrains Mono",monospace;font-size:12px;color:#fdba74';
      i.oninput = () => {
        out.textContent = i.value;
        onLive(Number(i.value), false);
      };
      i.onchange = () => onLive(Number(i.value), true);
      wrap.append(i, out);
      return wrap;
    };
    const colorIn = (value: string | undefined, onSet: (v: string | undefined) => void): HTMLInputElement => {
      const i = document.createElement('input');
      i.type = 'color';
      i.value = value ?? '#ffffff';
      i.style.cssText = inputCss + ';height:30px;padding:1px';
      i.onchange = () => onSet(i.value);
      return i;
    };
    const selectIn = (value: string, options: string[], onSet: (v: string) => void): HTMLSelectElement => {
      const s = document.createElement('select');
      s.style.cssText = inputCss;
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        s.appendChild(opt);
      }
      s.value = value;
      s.onchange = () => onSet(s.value);
      return s;
    };
    const checkIn = (value: boolean, onSet: (v: boolean) => void): HTMLInputElement => {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = value;
      i.onchange = () => onSet(i.checked);
      return i;
    };

    row('visible', checkIn(!!spot, (v) => setSpot(v ? {} : null)));
    if (spot) {
      const anchors = ['topLeft', 'topCenter', 'topRight', 'middleLeft', 'center', 'middleRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
      row('anchor', selectIn(spot.anchor, anchors, (v) => setSpot({ anchor: v as OverlaySpot['anchor'] })));
      row('padX', slideIn(spot.padX, -0.5, 0.5, STEP, 0, (v, c) => liveSpot({ padX: v }, c)));
      row('padY', slideIn(spot.padY, -0.5, 0.9, STEP, 0, (v, c) => liveSpot({ padY: v }, c)));
      row('render', selectIn(spot.render ?? (key === 'cost' || key === 'attack' || key === 'health' ? 'badge' : 'text'), ['text', 'badge'], (v) => setSpot({ render: v as 'text' | 'badge' })));
      row('size', slideIn(spot.size, 0.01, 0.2, 0.002, 0.04, (v, c) => liveSpot({ size: v }, c)));
      row('font', selectIn(spot.font ?? 'body', ['display', 'body', 'mono'], (v) => setSpot({ font: v as OverlaySpot['font'] })));
      row('color', colorIn(spot.color, (v) => setSpot({ color: v })));
      row('stroke', colorIn(spot.stroke, (v) => setSpot({ stroke: v })));
      row('strokeW', slideIn(spot.strokeThickness, 0, 0.03, 0.001, 0, (v, c) => liveSpot({ strokeThickness: v || undefined }, c)));
      row('bold', checkIn(!!spot.bold, (v) => setSpot({ bold: v || undefined })));
      row('italic', checkIn(!!spot.italic, (v) => setSpot({ italic: v || undefined })));
      row('UPPER', checkIn(!!spot.upper, (v) => setSpot({ upper: v || undefined })));
      row('align', selectIn(spot.align ?? 'auto', ['auto', 'left', 'center', 'right'], (v) => setSpot({ align: v === 'auto' ? undefined : (v as OverlaySpot['align']) })));
      row('wrap', slideIn(spot.wrap, 0, 1, 0.01, 0, (v, c) => liveSpot({ wrap: v || undefined }, c)));
      row('maxLines', numIn(spot.maxLines, 1, (v) => setSpot({ maxLines: v })));
      row('hideBelow', numIn(spot.hideBelow, 10, (v) => setSpot({ hideBelow: v })));
      const resetBtn = document.createElement('button');
      resetBtn.textContent = `↺ reset ${key}`;
      resetBtn.title = 'Restore this element to the theme/pack layout';
      resetBtn.style.cssText = btnCss + ';width:100%;margin:6px 0 0';
      resetBtn.onclick = () => {
        const original = this.base.elements?.[key];
        setSpot(original ? structuredClone(original) : null);
      };
      panel.appendChild(resetBtn);
    }

    // --- scrim ---
    h('div', 'SCRIM', heading);
    const scrim = this.draft.scrim ?? null;
    const setScrim = (patch: Partial<OverlayScrim> | null): void => {
      this.pushUndo();
      this.draft.scrim = patch === null ? null : { ...(scrim ?? {}), ...patch };
      this.save();
      this.rebuild();
    };
    const liveScrim = (patch: Partial<OverlayScrim>, commit: boolean): void => {
      if (commit) {
        this.sliding = false;
        this.save();
        this.rebuild();
        return;
      }
      if (!this.sliding) {
        this.sliding = true;
        this.pushUndo();
      }
      this.draft.scrim = { ...(this.draft.scrim ?? {}), ...patch };
      this.rebuildCard();
    };
    row('enabled', checkIn(!!scrim, (v) => setScrim(v ? {} : null)));
    if (scrim) {
      row('edge', selectIn(scrim.edge ?? 'bottom', ['bottom', 'top'], (v) => setScrim({ edge: v as 'bottom' | 'top' })));
      row('height', slideIn(scrim.height, 0.1, 1, 0.02, 0.48, (v, c) => liveScrim({ height: v }, c)));
      row('color', colorIn(scrim.color ?? '#000000', (v) => setScrim({ color: v })));
      row('alpha', slideIn(scrim.alpha, 0, 1, 0.02, 0.78, (v, c) => liveScrim({ alpha: v }, c)));
      row('fade', slideIn(scrim.fade, 0, 1, 0.02, 0.45, (v, c) => liveScrim({ fade: v }, c)));
      row('pattern', selectIn(scrim.pattern ?? 'none', ['none', 'stripes', 'dots', 'grid', 'noise', 'image'], (v) => setScrim({ pattern: v as OverlayScrim['pattern'] })));
      row('pat color', colorIn(scrim.patternColor ?? '#ffffff', (v) => setScrim({ patternColor: v })));
      row('pat alpha', slideIn(scrim.patternAlpha, 0, 1, 0.02, 0.35, (v, c) => liveScrim({ patternAlpha: v }, c)));
      row('pat scale', slideIn(scrim.patternScale, 0.25, 4, 0.25, 1, (v, c) => liveScrim({ patternScale: v }, c)));
    }

    h(
      'div',
      'The draft applies live in DEV games. Copy JSON, then paste as pack.json\'s top-level "layout" (or into THEME.card.overlay) to ship it.',
      'margin-top:12px;color:#6b7280;font-size:12px;line-height:1.5'
    );
  }

  private async copyJson(): Promise<void> {
    const json = JSON.stringify(this.draft, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.toast('Layout JSON copied — paste as "layout" in pack.json');
    } catch {
      // Clipboard unavailable (permissions): show it for manual copy.
      window.prompt('Copy the layout JSON:', json);
    }
  }

  private async pasteJson(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      raw = window.prompt('Paste the layout JSON:');
    }
    if (!raw) return;
    try {
      // Accept a bare layout, or a whole pack.json / {"layout": ...} wrapper.
      const parsed = JSON.parse(raw) as { layout?: unknown };
      const layout = isOverlayLayout(parsed.layout) ? parsed.layout : parsed;
      if (!isOverlayLayout(layout) || (!layout.elements && layout.scrim === undefined)) {
        this.toast('That JSON is not an overlay layout');
        return;
      }
      this.pushUndo();
      this.draft = structuredClone(mergeOverlayLayout(this.base, layout));
      this.save();
      this.rebuild();
      this.toast('Layout imported');
    } catch {
      this.toast('Could not parse that JSON');
    }
  }

  private toast(msg: string): void {
    const t = this.add
      .text(this.cardX, this.cardY - this.cardH / 2 - 12, msg, {
        fontFamily: THEME.fonts.body, fontSize: '18px', color: THEME.fx.toastText,
        backgroundColor: THEME.fx.toastBg, padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 26, delay: 1400, duration: 400, onComplete: () => t.destroy() });
  }
}

/** Round to the editor's 0.005 grid (kept float-noise-free for clean JSON). */
function round(n: number): number {
  return Number((Math.round(n * 200) / 200).toFixed(3));
}
