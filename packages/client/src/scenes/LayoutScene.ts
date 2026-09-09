import Phaser from 'phaser';
import {
  buildDemoDeck,
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
import { H, PORTRAIT, W } from '../layout.js';

/**
 * Dev-only layout editor for the `overlay` card style: one big card, a drag
 * handle per placed element (drop snaps to the nearest of the nine anchors
 * and back-computes the pads), and a side panel of per-element and scrim
 * controls. The work-in-progress persists as a localStorage draft that
 * applies live everywhere in DEV (see overlayConfig.mergedOverlay), and
 * **Copy JSON** exports the finished `layout` block for pack.json or
 * THEME.card.overlay. Reached from the menu's 🎨 button (DEV builds only).
 */

const ELEMENTS: OverlayElement[] = [
  'name', 'type', 'cost', 'attack', 'health', 'defense',
  'description', 'skills', 'rarity', 'moves', 'swapCost',
];

/** Fresh spot for an element being turned on with no prior placement. */
const BLANK_SPOT: OverlaySpot = { anchor: 'center', padX: 0, padY: 0, size: 0.04 };

export class LayoutScene extends Phaser.Scene {
  private pool: CardDef[] = [];
  private index = 0;
  private card: CardSprite | null = null;
  private handles: Phaser.GameObjects.Container[] = [];
  private handleDots = new Map<OverlayElement, Phaser.GameObjects.Arc>();
  private panel: HTMLDivElement | null = null;
  private selected: OverlayElement | null = null;
  private draft!: OverlayLayout;

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
  }

  create(): void {
    this.add.rectangle(W / 2, H / 2, W, H, 0x050505);
    this.cardW = PORTRAIT ? 480 : 460;
    this.cardH = this.cardW * (4 / 3);
    this.cardX = PORTRAIT ? W / 2 : W * 0.32;
    this.cardY = PORTRAIT ? H * 0.36 : H * 0.52;

    this.add
      .text(this.cardX, this.cardY - this.cardH / 2 - 46, '🎨 CARD LAYOUT (DEV)', {
        fontFamily: THEME.fonts.display, fontSize: '30px', color: THEME.menu.title,
      })
      .setOrigin(0.5);
    this.add
      .text(this.cardX, this.cardY + this.cardH / 2 + 30, 'drag a handle to move its element — drops snap to the nearest anchor', {
        fontFamily: THEME.fonts.body, fontSize: '16px', color: THEME.hud.bannerIdle,
      })
      .setOrigin(0.5);

    // Editing starts from whatever currently applies (draft included).
    this.draft = structuredClone(
      mergeOverlayLayout(THEME.card.overlay, getPackOverlayLayout(), getDraftOverlayLayout())
    );

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

  private rebuild(): void {
    this.card?.destroy();
    for (const handle of this.handles) handle.destroy();
    this.handles = [];
    this.handleDots.clear();
    this.card = new CardSprite(this, this.cardX, this.cardY, this.cardW, this.cardH, this.currentDef());

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
    c.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      c.setPosition(dragX, dragY);
    });
    c.on('dragend', () => {
      this.placeAt(key, c.x - this.cardX, c.y - this.cardY);
    });
    return c;
  }

  /** Snap a card-local drop point to the nearest anchor and store the pads. */
  private placeAt(key: OverlayElement, x: number, y: number): void {
    const w = this.cardW;
    const h = this.cardH;
    const col = x < -w / 6 ? 'Left' : x > w / 6 ? 'Right' : 'Center';
    const rowBand = y < -h / 6 ? 'top' : y > h / 6 ? 'bottom' : 'middle';
    const anchor = (
      rowBand === 'middle' && col === 'Center' ? 'center' : `${rowBand}${col}`
    ) as OverlaySpot['anchor'];
    // middleLeft/middleRight (side bands keep 'middle' prefix + side).
    const round = (n: number) => Math.round(n * 200) / 200; // 0.005 steps
    const padX = col === 'Left' ? round((x + w / 2) / w) : col === 'Right' ? round((w / 2 - x) / w) : round(x / w);
    const padY = rowBand === 'top' ? round((y + h / 2) / w) : rowBand === 'bottom' ? round((h / 2 - y) / w) : round(y / w);
    const prev = this.draft.elements?.[key] ?? BLANK_SPOT;
    this.draft.elements = { ...this.draft.elements, [key]: { ...prev, anchor, padX, padY } };
    this.selected = key;
    this.save();
    this.rebuild();
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
      'position:fixed', PORTRAIT ? 'left:0;right:0;bottom:0;max-height:44vh' : 'top:0;right:0;bottom:0;width:320px',
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
    const mkBtn = (label: string, onClick: () => void, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = btnCss + (primary ? ';background:#f97316;color:#000;border-color:#ea580c;font-weight:700' : '');
      b.onclick = onClick;
      bar.appendChild(b);
      return b;
    };
    mkBtn('‹', () => {
      this.index = (this.index + this.pool.length - 1) % this.pool.length;
      this.rebuild();
    });
    bar.appendChild(
      Object.assign(document.createElement('span'), {
        textContent: `${(this.index % this.pool.length) + 1}/${this.pool.length}`,
      })
    );
    mkBtn('›', () => {
      this.index = (this.index + 1) % this.pool.length;
      this.rebuild();
    });
    mkBtn('📋 Copy JSON', () => void this.copyJson(), true);
    mkBtn('↺ Reset', () => {
      setDraftOverlayLayout(null);
      this.draft = structuredClone(mergeOverlayLayout(THEME.card.overlay, getPackOverlayLayout()));
      this.rebuild();
    });
    mkBtn('← Menu', () => {
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
      this.selected = picker.value as OverlayElement;
      this.rebuild();
    };
    panel.appendChild(picker);

    const key = this.selected!;
    const spot = this.draft.elements?.[key] ?? null;
    const setSpot = (patch: Partial<OverlaySpot> | null): void => {
      this.draft.elements = { ...this.draft.elements, [key]: patch === null ? null : { ...(spot ?? BLANK_SPOT), ...patch } };
      this.save();
      this.rebuild();
    };

    const row = (label: string, input: HTMLElement): void => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0';
      const l = document.createElement('span');
      l.textContent = label;
      l.style.cssText = 'flex:0 0 96px;color:#9ca3af';
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
      row('padX', numIn(spot.padX, 0.005, (v) => setSpot({ padX: v })));
      row('padY', numIn(spot.padY, 0.005, (v) => setSpot({ padY: v })));
      row('render', selectIn(spot.render ?? (key === 'cost' || key === 'attack' || key === 'health' ? 'badge' : 'text'), ['text', 'badge'], (v) => setSpot({ render: v as 'text' | 'badge' })));
      row('size', numIn(spot.size, 0.002, (v) => setSpot({ size: v })));
      row('font', selectIn(spot.font ?? 'body', ['display', 'body', 'mono'], (v) => setSpot({ font: v as OverlaySpot['font'] })));
      row('color', colorIn(spot.color, (v) => setSpot({ color: v })));
      row('stroke', colorIn(spot.stroke, (v) => setSpot({ stroke: v })));
      row('strokeW', numIn(spot.strokeThickness, 0.002, (v) => setSpot({ strokeThickness: v })));
      row('bold', checkIn(!!spot.bold, (v) => setSpot({ bold: v || undefined })));
      row('italic', checkIn(!!spot.italic, (v) => setSpot({ italic: v || undefined })));
      row('UPPER', checkIn(!!spot.upper, (v) => setSpot({ upper: v || undefined })));
      row('align', selectIn(spot.align ?? 'auto', ['auto', 'left', 'center', 'right'], (v) => setSpot({ align: v === 'auto' ? undefined : (v as OverlaySpot['align']) })));
      row('wrap', numIn(spot.wrap, 0.01, (v) => setSpot({ wrap: v })));
      row('maxLines', numIn(spot.maxLines, 1, (v) => setSpot({ maxLines: v })));
      row('hideBelow', numIn(spot.hideBelow, 10, (v) => setSpot({ hideBelow: v })));
    }

    // --- scrim ---
    h('div', 'SCRIM', heading);
    const scrim = this.draft.scrim ?? null;
    const setScrim = (patch: Partial<OverlayScrim> | null): void => {
      this.draft.scrim = patch === null ? null : { ...(scrim ?? {}), ...patch };
      this.save();
      this.rebuild();
    };
    row('enabled', checkIn(!!scrim, (v) => setScrim(v ? {} : null)));
    if (scrim) {
      row('edge', selectIn(scrim.edge ?? 'bottom', ['bottom', 'top'], (v) => setScrim({ edge: v as 'bottom' | 'top' })));
      row('height', numIn(scrim.height ?? 0.48, 0.02, (v) => setScrim({ height: v })));
      row('color', colorIn(scrim.color ?? '#000000', (v) => setScrim({ color: v })));
      row('alpha', numIn(scrim.alpha ?? 0.78, 0.02, (v) => setScrim({ alpha: v })));
      row('fade', numIn(scrim.fade ?? 0.45, 0.02, (v) => setScrim({ fade: v })));
      row('pattern', selectIn(scrim.pattern ?? 'none', ['none', 'stripes', 'dots', 'grid', 'noise', 'image'], (v) => setScrim({ pattern: v as OverlayScrim['pattern'] })));
      row('pat color', colorIn(scrim.patternColor ?? '#ffffff', (v) => setScrim({ patternColor: v })));
      row('pat alpha', numIn(scrim.patternAlpha ?? 0.35, 0.02, (v) => setScrim({ patternAlpha: v })));
      row('pat scale', numIn(scrim.patternScale ?? 1, 0.25, (v) => setScrim({ patternScale: v })));
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
