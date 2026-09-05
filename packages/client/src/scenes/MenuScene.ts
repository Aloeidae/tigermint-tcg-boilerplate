import Phaser from 'phaser';
import {
  buildDemoDeck, buildStarterPokemonDeck, DECK_SIZE, DEMO_CATALOG, padDeck,
  POKEMON_DEMO_CARDS, RULE_PRESETS, type CardDef, type RulesConfig,
} from '@tcg/shared';
import { THEME } from '../theme.js';
import { loadLocalPack, packDeck, type LocalPack } from '../pack.js';
import { CONFIG } from '../config.js';
import { initWallet, tonConnect, walletAddress } from '../ton/wallet.js';
import {
  bocHash,
  confirmMint,
  getCollection,
  getMintTerms,
  getMintVoucher,
  getTokenMetadata,
  parseMintTerms,
  pullConfigured,
  pullCurrency,
  rememberPulled,
  tigermintNfts,
  walletIndices,
} from '../ton/pull.js';
import { fetchNfts, shortAddress, type NftItem } from '../ton/nfts.js';
import { nftToCard, withGameBlock } from '../ton/cardMapper.js';
import { CardSprite } from '../objects/CardSprite.js';
import type { DeckPoolEntry } from './DeckScene.js';
import { LocalAIConnection } from '../net/LocalAIConnection.js';
import { WsConnection } from '../net/WsConnection.js';
import { ReplayConnection, type ReplayData } from '../net/ReplayConnection.js';
import type { Connection } from '../net/Connection.js';
import { ensureArtTextures } from '../artLoader.js';
import { isMuted, playSound, toggleMuted } from '../audio.js';
import { PORTRAIT } from '../layout.js';

/**
 * Main menu. The interactive parts (wallet button, room-code input) live in
 * the DOM overlay defined in index.html; this scene wires them up and paints
 * the backdrop.
 */
export class MenuScene extends Phaser.Scene {
  private deck: CardDef[] = buildDemoDeck();
  private playerName = 'Player';
  private pendingConn: WsConnection | null = null;
  private rules: RulesConfig = RULE_PRESETS.duel.rules;
  private pack: LocalPack | null = null;
  private walletConnected = false;
  private walletAddr: string | null = null;
  /** The wallet's NFTs mapped to cards; survives scene switches. */
  private nftCards: CardDef[] = [];
  private demoPulling = false;
  /** Which of CONFIG.tigermintSlugs the pull panel is showing. */
  private activePack = 0;
  private packSwitching = false;
  /** Booster size for the next pull (the ×1/×5/×10 pills). */
  private pullCount = 1;

  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.scale;
    const T = THEME.menu;

    // Backdrop: a 'bg-menu' texture (preload it in BootScene) wins; otherwise
    // a furnace scene — solid black above (so a banner sits seamlessly), a
    // smooth warm glow pooling below, and rising embers over everything.
    if (this.textures.exists('bg-menu')) {
      this.add.image(width / 2, height / 2, 'bg-menu').setDisplaySize(width, height);
    } else {
      this.add.rectangle(width / 2, height / 2, width, height, T.skyTop);
      // Band-free glow: a real radial gradient baked into a canvas texture.
      if (!this.textures.exists('menu-glow')) {
        const size = 512;
        const tex = this.textures.createCanvas('menu-glow', size, size);
        if (tex) {
          const ctx = tex.getContext();
          const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
          grad.addColorStop(0, 'rgba(249, 115, 22, 0.55)');
          grad.addColorStop(0.35, 'rgba(234, 88, 12, 0.28)');
          grad.addColorStop(0.7, 'rgba(154, 52, 18, 0.08)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, size, size);
          tex.refresh();
        }
      }
      this.add
        .image(width / 2, height * 1.12, 'menu-glow')
        .setDisplaySize(width * 2, height * 1.3)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.5);
    }

    // Banner graphic ('menu-banner', public/pack/banner.png) replaces the
    // title text when present; embers are created after it, so they drift
    // in front of the banner.
    if (this.textures.exists('menu-banner')) {
      const src = this.textures.get('menu-banner').getSourceImage() as { width: number; height: number };
      const maxW = width * 0.56;
      const maxH = height * 0.4;
      const scale = Math.min(maxW / src.width, maxH / src.height);
      this.add.image(width / 2, height * 0.185, 'menu-banner').setScale(scale);
    } else {
      const title = this.add
        .text(width / 2, height * 0.12, 'TIGERMINT TCG', {
          fontFamily: THEME.fonts.display, fontSize: '92px', color: T.title,
          stroke: THEME.hud.bannerStroke, strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setShadow(0, 6, '#000000', 18, true, true);
      if (title.postFX) title.postFX.addGlow(0xf97316, 1.5, 0);
      this.tweens.add({ targets: title, scale: { from: 1, to: 1.015 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.add
        .text(width / 2, height * 0.185, 'A trading card game boilerplate — your NFTs are your deck', {
          fontFamily: THEME.fonts.body, fontSize: '22px', color: T.subtitle,
        })
        .setOrigin(0.5)
        .setAlpha(0.9);
    }

    // A soft round particle texture for the embers.
    if (!this.textures.exists('fx-ember')) {
      const pg = this.make.graphics({ x: 0, y: 0 }, false);
      pg.fillStyle(0xffffff, 0.25);
      pg.fillCircle(8, 8, 8);
      pg.fillStyle(0xffffff, 0.6);
      pg.fillCircle(8, 8, 4.5);
      pg.fillStyle(0xffffff, 1);
      pg.fillCircle(8, 8, 2.2);
      pg.generateTexture('fx-ember', 16, 16);
      pg.destroy();
    }
    // Embers drifting up from below, fading in and out as they climb.
    const emberAlpha: Phaser.Types.GameObjects.Particles.EmitterOpOnUpdateCallback = (_p, _k, t) =>
      Math.sin(Math.min(t, 1) * Math.PI) * 0.85;
    this.add.particles(0, 0, 'fx-ember', {
      x: { min: 0, max: width },
      y: height + 20,
      lifespan: { min: 7000, max: 12000 },
      speedY: { min: -30, max: -85 },
      speedX: { min: -14, max: 14 },
      scale: { start: 0.9, end: 0.15 },
      alpha: { onEmit: () => 0, onUpdate: emberAlpha },
      tint: [0xf97316, 0xfb923c, 0xfdba74, 0xea580c],
      quantity: 1,
      frequency: 220,
      advance: 9000, // start mid-scene so the screen is already alive
    });

    this.showOverlay(true);
    this.setError('');
    this.setBanner('');
    this.rebuildDeck();

    // A local pack (public/pack/pack.json) replaces the demo deck until a
    // wallet connects — handy for testing custom cards before minting.
    void loadLocalPack().then((pack) => {
      this.pack = pack;
      this.rebuildDeck();
    });

    // --- Rules preset picker (see RULE_PRESETS in @tcg/shared) ---
    const presetSelect = document.getElementById('rules-preset') as HTMLSelectElement;
    if (presetSelect.options.length === 0) {
      for (const [key, preset] of Object.entries(RULE_PRESETS)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `Rules: ${preset.label}`;
        presetSelect.appendChild(opt);
      }
    }
    const applyPreset = () => {
      const preset = RULE_PRESETS[presetSelect.value] ?? RULE_PRESETS.duel;
      this.rules = preset.rules;
      document.getElementById('rules-desc')!.textContent = preset.description;
    };
    presetSelect.onchange = applyPreset;
    applyPreset();

    // --- "Mint your own cards" link (TigerMint by default; VITE_MINT_URL) ---
    const mintLink = document.getElementById('mint-link') as HTMLAnchorElement;
    if (CONFIG.mintUrl) {
      mintLink.href = CONFIG.mintUrl;
      mintLink.style.display = 'block';
    } else {
      mintLink.style.display = 'none';
    }

    // --- Wallet ---
    initWallet((address) => {
      void this.onWalletChange(address);
      if (pullConfigured()) void this.refreshPull();
    });

    // --- TigerMint pull-a-card panel ---
    this.setupPullPanel();

    // --- Buttons (onclick assignment keeps re-entry into this scene idempotent) ---
    // Mute toggle (see src/audio.ts).
    const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
    btnMute.textContent = isMuted() ? '🔇' : '🔊';
    btnMute.onclick = () => {
      btnMute.textContent = toggleMuted() ? '🔇' : '🔊';
      playSound('click');
    };

    const btnAi = document.getElementById('btn-ai') as HTMLButtonElement;
    const btnDeck = document.getElementById('btn-deck') as HTMLButtonElement;
    const btnQueue = document.getElementById('btn-queue') as HTMLButtonElement;
    const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
    const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
    const btnSpectate = document.getElementById('btn-spectate') as HTMLButtonElement;
    btnAi.onclick = () => void this.startVsAi();
    btnDeck.onclick = () => void this.openDeckBuilder();
    btnQueue.onclick = () => this.toggleQueue();
    btnCreate.onclick = () => this.startPvp('create');
    btnJoin.onclick = () => this.startPvp('join');
    btnSpectate.onclick = () => this.startPvp('spectate');

    // Replays: pick a saved .json and watch it back.
    const replayLink = document.getElementById('replay-link') as HTMLAnchorElement;
    const replayFile = document.getElementById('replay-file') as HTMLInputElement;
    replayLink.onclick = (e) => {
      e.preventDefault();
      replayFile.click();
    };
    replayFile.onchange = () => {
      const file = replayFile.files?.[0];
      replayFile.value = '';
      if (file) void this.watchReplay(file);
    };

    // A refresh mid-PvP-game leaves a seat token behind — pick the game back up.
    this.resumeSeatIfAny();

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      btnAi.onclick = null;
      btnDeck.onclick = null;
      btnQueue.onclick = null;
      btnCreate.onclick = null;
      btnJoin.onclick = null;
      btnSpectate.onclick = null;
      replayLink.onclick = null;
      replayFile.onchange = null;
      for (const id of ['btn-pull', 'pull-prev', 'pull-next', 'pull-sheet-toggle', 'pull-hide']) {
        const el = document.getElementById(id) as HTMLButtonElement | null;
        if (el) el.onclick = null;
      }
    });
  }

  /** "Find Opponent": queue for an automatic match; click again to cancel. */
  private toggleQueue(): void {
    const btn = document.getElementById('btn-queue') as HTMLButtonElement;
    if (this.pendingConn) {
      // Cancel an active search.
      (this.pendingConn as WsConnection).cancelQueue?.();
      this.pendingConn.dispose();
      this.pendingConn = null;
      btn.textContent = '🎯 Find Opponent';
      this.setBanner('');
      return;
    }
    this.setError('');
    const queueDeck = this.gameDeck();
    const conn = WsConnection.queue(CONFIG.serverUrl, queueDeck, this.playerName, this.rules);
    this.pendingConn = conn;
    conn.onQueued = () => this.setBanner('Searching for an opponent on the same rules… (click Find Opponent to cancel)');
    conn.onError = (msg) => {
      this.setBanner('');
      btn.textContent = '🎯 Find Opponent';
      this.setError(msg);
    };
    conn.onClose = (msg) => {
      this.pendingConn = null;
      this.setBanner('');
      btn.textContent = '🎯 Find Opponent';
      if (msg !== 'Search cancelled') this.setError(msg);
    };
    conn.onGameStart = () => {
      void ensureArtTextures(this, queueDeck).then(() => {
        this.pendingConn = null;
        btn.textContent = '🎯 Find Opponent';
        this.launch(conn);
      });
    };
    btn.textContent = '✕ Cancel search';
  }

  /** Play a downloaded replay file through the normal game scene. */
  private async watchReplay(file: File): Promise<void> {
    this.setError('');
    try {
      const data = JSON.parse(await file.text()) as ReplayData;
      if (!data || !Array.isArray(data.commands) || !Array.isArray(data.decks)) {
        this.setError('That file is not a replay.');
        return;
      }
      await ensureArtTextures(this, [...data.decks[0], ...data.decks[1]]);
      this.launch(new ReplayConnection(data));
    } catch {
      this.setError('Could not read that replay file.');
    }
  }

  /** After a refresh mid-game, quietly reclaim the PvP seat if one is saved. */
  private resumeSeatIfAny(): void {
    const conn = WsConnection.resume(CONFIG.serverUrl);
    if (!conn) return;
    this.setBanner('Reconnecting to your game…');
    conn.onGameStart = () => {
      const deck = conn.lastView ? [] : this.deck;
      void ensureArtTextures(this, deck).then(() => {
        this.setBanner('');
        this.launch(conn);
      });
    };
    const giveUp = (): void => {
      this.setBanner('');
      try {
        sessionStorage.removeItem('tm-seat');
      } catch {
        // fine
      }
      conn.dispose();
    };
    conn.onError = giveUp;
    conn.onClose = giveUp;
  }

  private async onWalletChange(address: string | null): Promise<void> {
    this.walletConnected = address !== null;
    this.walletAddr = address;
    if (!address) {
      this.nftCards = [];
      this.playerName = 'Player';
      this.rebuildDeck();
      return;
    }
    this.playerName = shortAddress(address);
    this.setStatus('Wallet connected — fetching your NFTs…');
    // Two sources, merged: TonAPI (any collection, once indexed) and
    // TigerMint's own holdings (instant for configured drops — public
    // indexers can lag a brand-new collection by hours). Dedupe by
    // collection + token index so a card never joins twice.
    const [fromChain, fromTigermint] = await Promise.all([
      fetchNfts(address).catch(() => [] as NftItem[]),
      tigermintNfts(address).catch(() => [] as NftItem[]),
    ]);
    const seen = new Set(
      fromChain
        .filter((n) => n.collection && n.index !== undefined)
        .map((n) => `${n.collection}#${n.index}`)
    );
    const nfts = [
      ...fromChain,
      ...fromTigermint.filter((n) => !seen.has(`${n.collection}#${n.index}`)),
    ];
    // Pokemon-mode data rides along from the pack manifest (matched by name).
    this.nftCards = nfts.map((n) => withGameBlock(nftToCard(n), this.pack));
    this.rebuildDeck();
  }

  // ---------------------------------------------------------- deck building

  /**
   * The basic deck's card list: your pack's freely playable cards, else the
   * demo catalog. Mint-only cards (rares and up, unless a card's `basic`
   * field says otherwise) are NOT in here — they enter play as owned NFTs.
   */
  private standardCards(): CardDef[] {
    if (this.pack) {
      return this.pack.basicCards.length > 0 ? this.pack.basicCards : this.pack.cards;
    }
    return DEMO_CATALOG;
  }

  /** Everything pickable in the deck builder, with per-card copy limits. */
  private deckPool(): DeckPoolEntry[] {
    const pool: DeckPoolEntry[] = [];
    const counts = new Map<string, number>();
    for (const c of this.nftCards) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    const seen = new Set<string>();
    for (const c of this.nftCards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      pool.push({ def: c, max: counts.get(c.id) ?? 1, owned: true });
    }
    for (const c of this.standardCards()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      pool.push({ def: c, max: 3 });
    }
    // Mint-only cards show locked in the basic section — visible, unplayable
    // until pulled (the owned copy above is the playable one).
    if (this.pack) {
      for (const c of this.pack.cards) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        pool.push({ def: c, max: 0, locked: true });
      }
    }
    return pool;
  }

  private deckStorageKey(): string {
    return `tm-deck-${this.walletAddr ?? 'local'}`;
  }

  private loadSavedDeckIds(): string[] | null {
    try {
      const raw = localStorage.getItem(this.deckStorageKey());
      if (!raw) return null;
      const ids = JSON.parse(raw) as unknown;
      return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : null;
    } catch {
      return null;
    }
  }

  private fillWithStandard(cards: CardDef[]): CardDef[] {
    const deck = cards.slice(0, DECK_SIZE);
    const std = this.standardCards();
    for (let i = 0; deck.length < DECK_SIZE && std.length > 0; i++) deck.push(std[i % std.length]);
    return padDeck(deck);
  }

  /**
   * Rebuild this.deck from the current state, in priority order: the deck
   * builder's saved picks (per wallet), else owned NFTs + standard fill,
   * else the local pack, else the demo deck. Also narrates the result.
   */
  private rebuildDeck(): void {
    const saved = this.loadSavedDeckIds();
    if (saved) {
      const pool = this.deckPool();
      const remaining = new Map(pool.map((p) => [p.def.id, p.max] as const));
      const byId = new Map(pool.map((p) => [p.def.id, p.def] as const));
      const cards: CardDef[] = [];
      for (const id of saved) {
        const def = byId.get(id);
        const left = remaining.get(id) ?? 0;
        if (!def || left <= 0 || cards.length >= DECK_SIZE) continue;
        remaining.set(id, left - 1);
        cards.push(def);
      }
      if (cards.length > 0) {
        this.deck = this.fillWithStandard(cards);
        const dropped = saved.length - cards.length;
        this.setStatus(
          `Custom deck: ${cards.length} picked card${cards.length === 1 ? '' : 's'}` +
            `${cards.length < DECK_SIZE ? ', standard deck fills the rest' : ''}` +
            `${dropped > 0 ? ` (${dropped} saved pick${dropped === 1 ? '' : 's'} no longer available)` : ''}.`
        );
        return;
      }
    }
    if (this.nftCards.length > 0) {
      // Owned NFTs join once each; the standard deck fills the rest —
      // play day one, mint boosters as you go.
      this.deck = this.fillWithStandard(this.nftCards);
      const many = CONFIG.collectionAddresses.length > 1;
      const scope =
        CONFIG.collectionAddresses.length > 0
          ? `from the configured collection${many ? 's' : ''}`
          : 'in your wallet';
      this.setStatus(
        `${this.nftCards.length} minted card${this.nftCards.length === 1 ? '' : 's'} ${scope} in your deck; the standard deck fills the rest.`
      );
    } else if (this.walletConnected) {
      this.deck = this.pack ? packDeck(this.pack) : buildDemoDeck();
      this.setStatus('No NFTs found — using the standard deck. Pull to add cards!');
    } else if (this.pack) {
      this.deck = packDeck(this.pack);
      this.setStatus(
        `Playing "${this.pack.name}" — ${this.pack.cards.length} custom cards from public/pack/. Connect a wallet to use NFTs instead.`
      );
    } else {
      this.deck = buildDemoDeck();
      this.setStatus('Playing with the built-in demo deck. Connect a TON wallet to use your NFTs.');
    }
  }

  /**
   * The deck a match actually starts with. Standard presets use this.deck;
   * pokemon (League) presets need stickers/energy/trainers instead, so a
   * starter deck is assembled from every available card with a `game` block
   * (local pack + owned NFTs), falling back to the built-in league demo set.
   */
  private gameDeck(): CardDef[] {
    if (this.rules.gameMode !== 'pokemon') return this.deck;
    const pool = [...(this.pack?.cards ?? []), ...this.nftCards].filter((d) => d.game);
    return buildStarterPokemonDeck(pool.length > 0 ? pool : POKEMON_DEMO_CARDS, this.rules.deckSize);
  }

  /** Open the deck builder over everything currently pickable. */
  private async openDeckBuilder(): Promise<void> {
    this.setError('');
    const pool = this.deckPool();
    await ensureArtTextures(this, pool.map((p) => p.def));
    // Seed the builder with the saved picks, capped by what's available now.
    const counts: Record<string, number> = {};
    const max = new Map(pool.map((p) => [p.def.id, p.max] as const));
    let total = 0;
    for (const id of this.loadSavedDeckIds() ?? []) {
      if (total >= DECK_SIZE) break;
      if ((counts[id] ?? 0) < (max.get(id) ?? 0)) {
        counts[id] = (counts[id] ?? 0) + 1;
        total += 1;
      }
    }
    this.showOverlay(false);
    this.scene.start('Deck', { pool, counts, storageKey: this.deckStorageKey() });
  }

  private async startVsAi(): Promise<void> {
    this.setError('');
    const deck = this.gameDeck();
    await ensureArtTextures(this, deck);
    // The AI plays a mirror of your deck, so its cards have real artwork too.
    const conn = new LocalAIConnection(deck, deck, this.playerName, this.rules);
    this.launch(conn);
  }

  private startPvp(mode: 'create' | 'join' | 'spectate'): void {
    this.setError('');
    this.pendingConn?.dispose();

    const deck = this.gameDeck();
    let conn: WsConnection;
    if (mode === 'create') {
      // The room creator's rules preset governs the match.
      conn = WsConnection.create(CONFIG.serverUrl, deck, this.playerName, this.rules);
      conn.onRoomCode = (code) => this.setBanner(`Room code: ${code} — waiting for an opponent…`);
    } else {
      const code = (document.getElementById('room-code') as HTMLInputElement).value.trim();
      if (code.length === 0) {
        this.setError(mode === 'spectate' ? 'Enter the room code to watch.' : 'Enter a room code to join.');
        return;
      }
      if (mode === 'spectate') {
        conn = WsConnection.spectate(CONFIG.serverUrl, code);
        this.setBanner(`Watching room ${code.toUpperCase()}…`);
        conn.onNotice = (msg) => this.setBanner(msg);
      } else {
        conn = WsConnection.join(CONFIG.serverUrl, code, deck, this.playerName);
        this.setBanner(`Joining room ${code.toUpperCase()}…`);
      }
    }

    this.pendingConn = conn;
    conn.onError = (msg) => {
      this.setBanner('');
      this.setError(msg);
    };
    conn.onClose = (msg) => {
      this.setBanner('');
      this.setError(msg);
    };
    conn.onGameStart = () => {
      void ensureArtTextures(this, deck).then(() => {
        this.pendingConn = null;
        this.launch(conn);
      });
    };
  }

  private launch(conn: Connection): void {
    this.setBanner('');
    this.showOverlay(false);
    this.scene.start('Game', { conn });
  }

  // ------------------------------------------------- TigerMint pull-a-card

  /**
   * The hideable "Pull a card" panel: blind-pull straight from the menu using
   * TigerMint's mint API (see src/ton/pull.ts for setup). Hidden entirely
   * unless VITE_TIGERMINT_SLUG + VITE_TIGERMINT_API_KEY are configured.
   */
  /** The pack the panel is showing (multiple = booster sets, arrow-switchable). */
  private activeSlug(): string {
    return CONFIG.tigermintSlugs[this.activePack] ?? '';
  }

  private setupPullPanel(): void {
    const panel = document.getElementById('pull-panel')!;
    const reveal = document.getElementById('pull-reveal') as HTMLButtonElement;
    const hide = document.getElementById('pull-hide') as HTMLButtonElement;
    const btn = document.getElementById('btn-pull') as HTMLButtonElement;
    const prev = document.getElementById('pull-prev') as HTMLButtonElement;
    const next = document.getElementById('pull-next') as HTMLButtonElement;
    const sheetToggle = document.getElementById('pull-sheet-toggle') as HTMLButtonElement;

    if (PORTRAIT) {
      // One-page phone menu: the panel is a bottom drawer, summoned by the
      // glowing ▲ and dismissed by the glowing ▼ handle — never permanently
      // hidden.
      panel.style.display = 'flex';
      reveal.style.display = 'none';
      hide.textContent = '▼';
      hide.title = 'Close';
      sheetToggle.onclick = () => {
        panel.classList.add('sheet-open');
        sheetToggle.style.display = 'none';
        playSound('click');
      };
      hide.onclick = () => {
        panel.classList.remove('sheet-open');
        sheetToggle.style.display = 'flex';
      };
    } else {
      // Desktop: builder default (VITE_PULL_PANEL) seeds visibility; the
      // player's own hide/show choice is remembered and wins from then on.
      const isHidden = () => {
        try {
          const choice = localStorage.getItem('tm-pull-hidden');
          if (choice !== null) return choice === '1';
        } catch { /* fall through to default */ }
        return CONFIG.pullPanelDefault === 'hidden';
      };
      const applyHidden = () => {
        const h = isHidden();
        panel.style.display = h ? 'none' : 'flex';
        reveal.style.display = h ? 'inline-block' : 'none';
      };
      hide.onclick = () => { try { localStorage.setItem('tm-pull-hidden', '1'); } catch { /* fine */ } applyHidden(); };
      reveal.onclick = () => { try { localStorage.setItem('tm-pull-hidden', '0'); } catch { /* fine */ } applyHidden(); };
      applyHidden();
    }

    if (pullConfigured()) {
      btn.onclick = () => void this.doPull();
      // With multiple configured packs, the side arrows page between them.
      if (CONFIG.tigermintSlugs.length > 1) {
        prev.style.display = 'block';
        next.style.display = 'block';
        prev.onclick = () => void this.switchPack(-1);
        next.onclick = () => void this.switchPack(1);
      }
      void this.loadCollectionInfo();
      void this.refreshPull();
    } else {
      // Demo mode: pull random cards from the full set with a reveal, so the
      // panel is alive even before a TigerMint drop is wired up.
      this.populatePullInfo(null);
      this.renderPullCounts(10, () => {
        btn.textContent = this.pullCount > 1 ? `Pull ×${this.pullCount} · demo` : 'Pull · demo';
      });
      btn.textContent = 'Pull · demo';
      this.setPullStatus('Demo pull. Set VITE_TIGERMINT_SLUG + API key for real on-chain pulls.');
      btn.onclick = () => void this.doDemoPull();
    }
  }

  /** The ×1/×5/×10 booster-size pills, capped by what the drop allows. */
  private renderPullCounts(maxPull: number, onChange: () => void): void {
    const el = document.getElementById('pull-counts');
    if (!el) return;
    const options = [1, 5, 10].filter((n) => n === 1 || n <= maxPull);
    if (this.pullCount > maxPull) this.pullCount = 1;
    el.replaceChildren();
    if (options.length < 2) {
      el.style.display = 'none';
      this.pullCount = 1;
      return;
    }
    for (const n of options) {
      const pill = document.createElement('button');
      pill.className = `pull-count${n === this.pullCount ? ' active' : ''}`;
      pill.textContent = `×${n}`;
      pill.onclick = () => {
        this.pullCount = n;
        for (const other of Array.from(el.children)) other.classList.toggle('active', other === pill);
        onChange();
      };
      el.appendChild(pill);
    }
    el.style.display = 'flex';
  }

  /** Fill the pull panel's cover, name, and details (null = demo placeholders). */
  private populatePullInfo(info: import('../ton/pull.js').CollectionInfo | null): void {
    const cover = document.getElementById('pull-cover') as HTMLImageElement;
    const name = document.getElementById('pull-name')!;
    const details = document.getElementById('pull-details')!;

    const coverUrl = info
      ? (info.coverImage ?? info.cover_image ?? info.cover ?? info.image)
      : '/pack/back.jpeg';
    if (coverUrl) {
      cover.onerror = () => { cover.style.display = 'none'; };
      cover.src = String(coverUrl);
      cover.style.display = 'block';
    } else {
      cover.style.display = 'none';
    }

    if (info) {
      name.textContent = String(info.name ?? this.activeSlug());
      const desc = info.description ? String(info.description) : '';
      details.textContent = desc.length > 140 ? `${desc.slice(0, 139)}…` : desc;
    } else {
      name.textContent = this.pack?.name ?? 'Your Collection';
      details.textContent = 'Blind-pull straight from your TigerMint drop: cover, phase, price, and live supply appear here.';
      document.getElementById('pull-phase')!.style.display = 'none';
      document.getElementById('pull-supply')!.style.display = 'none';
    }
  }

  private async loadCollectionInfo(): Promise<void> {
    const slug = this.activeSlug();
    try {
      const info = await getCollection(slug);
      if (slug !== this.activeSlug()) return; // switched away while loading
      this.populatePullInfo(info);
    } catch {
      if (slug !== this.activeSlug()) return;
      this.populatePullInfo(null);
    }
  }

  /**
   * Page the panel to the previous/next configured pack: the pack's whole
   * body slides out one side and the new one slides in from the other.
   */
  private async switchPack(dir: -1 | 1): Promise<void> {
    const slugs = CONFIG.tigermintSlugs;
    if (slugs.length < 2 || this.packSwitching) return;
    this.packSwitching = true;
    const body = document.getElementById('pull-body')!;
    const out = dir === 1 ? 'switch-left' : 'switch-right';
    const from = dir === 1 ? 'switch-right' : 'switch-left';
    try {
      body.classList.add(out);
      await new Promise((r) => setTimeout(r, 170));
      this.activePack = (this.activePack + dir + slugs.length) % slugs.length;

      // While the fresh data loads, show the slug so the panel never lies.
      document.getElementById('pull-name')!.textContent = this.activeSlug();
      document.getElementById('pull-details')!.textContent = '';
      this.setPullStatus('Checking the drop…');

      // Jump (unanimated) to the far side, then release to slide in.
      body.classList.add('switch-instant', from);
      body.classList.remove(out);
      void body.offsetWidth;
      body.classList.remove('switch-instant');
      void body.offsetWidth;
      body.classList.remove(from);

      await Promise.all([this.loadCollectionInfo(), this.refreshPull()]);
    } finally {
      body.classList.remove(out, from, 'switch-instant');
      this.packSwitching = false;
    }
  }

  /**
   * A theatrical no-chain pull: the menu fades away and the card flips,
   * front and center, before the menu returns.
   */
  private async doDemoPull(): Promise<void> {
    // Demo pulls draw from the FULL set (mint-only rares included) — that's
    // the point of a booster, and it shows off the whole pack.
    const source = this.pack?.cards ?? this.deck;
    if (this.demoPulling || source.length === 0) return;
    this.demoPulling = true;
    const btn = document.getElementById('btn-pull') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const cards: CardDef[] = [];
      for (let i = 0; i < this.pullCount; i++) {
        cards.push(source[Math.floor(Math.random() * source.length)]);
      }
      this.setPullStatus('Pulling…');
      await this.revealPulls(cards);
      const names = cards.map((c) => c.name);
      this.setPullStatus(`You pulled ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}! (demo)`);
    } finally {
      btn.disabled = false;
      this.demoPulling = false;
    }
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }

  /**
   * The pull reveal, singles and boosters alike: the menu fades away and
   * each card back flips over front and center; in a multi-pull the revealed
   * cards fan out into a row as the next one flips.
   */
  private async revealPulls(defs: CardDef[]): Promise<void> {
    if (defs.length === 0) return;
    const overlay = document.getElementById('menu')!;
    const { width, height } = this.scale;
    const n = defs.length;
    const cx = width / 2;
    const cy = height * 0.47;
    const w = 390;
    const h = 520;
    await ensureArtTextures(this, defs);
    const spread = Math.min(250, (width * 0.88) / n);
    const fanScale = n > 1 ? Math.max(0.38, Math.min(0.6, (spread - 14) / w)) : 1;

    overlay.classList.add('reveal-active');
    const kept: Phaser.GameObjects.Container[] = [];
    try {
      for (let i = 0; i < n; i++) {
        playSound('pull');
        const def = defs[i];
        const back = new CardSprite(this, cx, cy + 40, w, h, def, { faceDown: true });
        back.setDepth(60).setScale(0.5).setAlpha(0);
        await this.tween({ targets: back, alpha: 1, scale: 1, y: cy, duration: n > 1 ? 200 : 260, ease: 'Back.easeOut' });
        await this.tween({ targets: back, angle: { from: -2.5, to: 2.5 }, duration: 80, yoyo: true, repeat: n > 1 ? 2 : 3 });
        back.setAngle(0);
        await this.tween({ targets: back, scaleX: 0, duration: 130, ease: 'Cubic.easeIn' });
        back.destroy();

        const face = this.makeRevealFace(def, w, h).setPosition(cx, cy).setDepth(50 + i).setScale(0, 1);
        await this.tween({ targets: face, scaleX: 1, duration: 150, ease: 'Cubic.easeOut' });
        kept.push(face);

        // Everything revealed so far slides into a growing fan row.
        if (n > 1) {
          kept.forEach((f, j) => {
            const fx = cx + (j - (kept.length - 1) / 2) * spread;
            this.tweens.add({
              targets: f, x: fx, y: cy + 24, scaleX: fanScale, scaleY: fanScale,
              duration: 220, ease: 'Cubic.easeOut',
            });
          });
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      await new Promise((r) => setTimeout(r, n > 1 ? 2200 : 2400));
      await Promise.all(
        kept.map((f) => this.tween({ targets: f, alpha: 0, y: f.y - 60, duration: 320, ease: 'Cubic.easeIn' }))
      );
    } finally {
      for (const f of kept) f.destroy();
      overlay.classList.remove('reveal-active');
    }
  }

  /** One revealed card: raw full-bleed art when it's a complete design, else a drawn card. */
  private makeRevealFace(def: CardDef, w: number, h: number): Phaser.GameObjects.Container {
    const texKey = `art:${def.id}`;
    if (def.fullArt && def.art && this.textures.exists(texKey)) {
      const face = this.add.container(0, 0);
      const img = this.add.image(0, 0, texKey).setDisplaySize(w, h);
      const border = this.add.graphics();
      border.lineStyle(3, 0x000000, 1);
      border.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      face.add([img, border]);
      if (img.postFX) img.postFX.addGlow(0xf97316, 2, 0);
      return face;
    }
    const sprite = new CardSprite(this, 0, 0, w, h, def);
    if (sprite.postFX) sprite.postFX.addGlow(0xf97316, 2, 0);
    return sprite;
  }

  private setPullStatus(text: string): void {
    const el = document.getElementById('pull-status');
    if (el) el.textContent = text;
  }

  private async refreshPull(keepStatus = false): Promise<void> {
    const btn = document.getElementById('btn-pull') as HTMLButtonElement | null;
    if (!btn) return;
    const slug = this.activeSlug();
    try {
      const wallet = walletAddress() ?? undefined;
      const terms = parseMintTerms(await getMintTerms(slug, wallet));
      if (slug !== this.activeSlug()) return; // switched away while loading
      // Button shows the wallet-exact total for the chosen booster size.
      const setLabel = () => {
        if (!terms.price) {
          btn.textContent = this.pullCount > 1 ? `Pull ×${this.pullCount}` : 'Pull';
          return;
        }
        const total = parseFloat((parseFloat(terms.price) * this.pullCount).toFixed(4));
        btn.textContent = `Pull ×${this.pullCount} — ${total} ${pullCurrency()}`;
      };
      this.renderPullCounts(terms.maxPull, setLabel);
      setLabel();
      const price = terms.price ? `${terms.price} ${pullCurrency()}` : '';

      // Phase row (TigerMint collection-page style: accent bar, price, LIVE chip).
      const phaseEl = document.getElementById('pull-phase')!;
      phaseEl.replaceChildren();
      if (terms.phase) {
        const name = document.createElement('span');
        name.className = 'phase-name';
        name.textContent = terms.phase;
        const priceSpan = document.createElement('span');
        priceSpan.className = 'phase-price';
        priceSpan.textContent = price;
        phaseEl.append(name, priceSpan);
        if (terms.live) {
          const chip = document.createElement('span');
          chip.className = 'phase-live';
          chip.textContent = 'LIVE';
          phaseEl.append(chip);
        }
        phaseEl.style.display = 'flex';
      } else {
        phaseEl.style.display = 'none';
      }

      // Supply progress bar.
      const supplyEl = document.getElementById('pull-supply')!;
      if (terms.minted !== undefined && terms.total) {
        const pct = Math.round((terms.minted / terms.total) * 100);
        document.getElementById('supply-count')!.textContent = `${terms.minted} / ${terms.total} · ${pct}%`;
        (document.getElementById('supply-fill') as HTMLElement).style.width = `${pct}%`;
        supplyEl.style.display = 'flex';
      } else {
        supplyEl.style.display = 'none';
      }

      if (wallet && terms.eligible === false) {
        btn.disabled = true;
        if (!keepStatus) this.setPullStatus(terms.reason ?? 'This wallet is not eligible right now.');
      } else {
        btn.disabled = false;
        if (!keepStatus) {
          this.setPullStatus(wallet ? 'One blind pull, straight into your deck.' : 'Connect a wallet to pull.');
        }
      }
    } catch {
      if (slug !== this.activeSlug()) return;
      btn.disabled = true;
      if (!keepStatus) this.setPullStatus("Couldn't reach the drop. Check the collection slug and API key.");
    }
  }

  private async doPull(): Promise<void> {
    const btn = document.getElementById('btn-pull') as HTMLButtonElement;
    const addr = walletAddress();
    if (!addr) {
      void tonConnect()?.openModal();
      return;
    }
    // Pin the pack and booster size: switching mid-pull must not reroute the poll.
    const slug = this.activeSlug();
    const count = this.pullCount;
    let pulled = false;
    btn.disabled = true;
    try {
      this.setPullStatus('Preparing your pull…');
      const before = await walletIndices(addr, slug).catch(() => new Set<number>());
      const pull = await getMintVoucher(slug, addr, count);
      this.setPullStatus('Confirm the pull in your wallet…');
      const sent = await tonConnect()!.sendTransaction({
        validUntil: pull.message.validUntil,
        messages: [{ address: pull.message.to, amount: pull.message.amount, payload: pull.message.payloadBase64 }],
      });
      this.setPullStatus(`Pull ×${count} sent! Waiting for the chain…`);

      // Watch for the cards landing. Two signals, either one counts: the
      // exact indices appearing in TigerMint's wallet holdings, or — since
      // holdings can lag the chain — the supply advancing past the last of
      // the voucher's reserved indices (indices mint sequentially).
      const deadline = Date.now() + 180_000;
      let landed: number[] = [];
      while (Date.now() < deadline && landed.length < count) {
        await new Promise((r) => setTimeout(r, 5000));
        const now = await walletIndices(addr, slug).catch(() => null);
        if (now) {
          landed = [...now]
            .filter((i) => !before.has(i) && i >= pull.voucher.startIndex)
            .sort((a, b) => a - b)
            .slice(0, count);
          if (landed.length >= count) break;
        }
        const terms = await getMintTerms(slug).catch(() => null);
        const minted = terms?.supply?.minted;
        if (minted !== undefined && minted >= pull.voucher.startIndex + count) {
          landed = Array.from({ length: count }, (_, i) => pull.voucher.startIndex + i);
        }
      }
      if (landed.length > 0) {
        // Remember these locally so the deck shows them IMMEDIATELY — the
        // holdings mirror can trail the mint by minutes.
        rememberPulled(slug, landed);
        void bocHash(sent.boc)
          .catch(() => '')
          .then((hash) => confirmMint(slug, addr, landed.length, hash, landed));
        this.setPullStatus(landed.length > 1 ? 'They landed! Revealing…' : 'It landed! Revealing…');
        // Reveal from each token's own metadata — exactly what the wallet sees.
        const metas = await Promise.all(
          landed.map((i) => getTokenMetadata(slug, i).catch(() => null))
        );
        const defs: CardDef[] = landed.map((idx, i) => ({
          id: `pull-${slug}-${idx}`,
          name: metas[i]?.name ?? `#${idx}`,
          type: 'spell',
          cost: 0,
          art: metas[i]?.image,
          fullArt: true,
        }));
        await this.revealPulls(defs.filter((d) => d.art));
        pulled = true;
        const names = defs.map((d) => d.name);
        const summary = `${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
        this.setPullStatus(`You pulled ${summary}! Refreshing your deck…`);
        await this.onWalletChange(addr);
        this.setPullStatus(`You pulled ${summary}! ${landed.length > 1 ? "They're" : "It's"} in your deck.`);
        // TonAPI can lag freshly minted NFTs by a few seconds — refresh once
        // more so the new cards are sure to be in the deck.
        setTimeout(() => void this.onWalletChange(walletAddress()), 12_000);
      } else {
        this.setPullStatus('Pull sent. It can take a minute to land; your cards will appear in your wallet.');
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      this.setPullStatus(/reject|cancel|declin/i.test(msg) ? 'Pull cancelled.' : `Pull failed: ${msg}`);
    } finally {
      btn.disabled = false;
      // After a successful pull, keep the "You pulled X!" line — the refresh
      // must not overwrite it with the idle prompt.
      void this.refreshPull(pulled);
    }
  }

  private showOverlay(show: boolean): void {
    document.getElementById('menu')!.style.display = show ? 'flex' : 'none';
  }
  private setStatus(text: string): void {
    document.getElementById('deck-status')!.textContent = text;
  }
  private setBanner(text: string): void {
    const el = document.getElementById('room-banner')!;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }
  private setError(text: string): void {
    const el = document.getElementById('menu-error')!;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }
}
