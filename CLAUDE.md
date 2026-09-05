# Tigermint TCG Boilerplate — guide for AI assistants

A trading card game engine where TON NFTs become playable cards. This file is
the working context for LLM coding agents extending the boilerplate.

## Commands

```bash
npm install          # once, at the repo root (npm workspaces)
npm run dev          # Vite client -> http://localhost:8080
npm run dev:server   # PvP WebSocket server -> ws://localhost:8081
npm test             # engine test suite (packages/shared, tsx --test)
npm run typecheck    # strict tsc across all packages
npm run build        # production client build
```

Run `npm test` and `npm run typecheck` after any change to `packages/shared`.

## Architecture in one breath

- `packages/shared` — the game. Pure TypeScript, zero dependencies, no
  rendering. A **pure reducer**: `applyCommand(state, command) ->
  { ok, state, events } | { ok: false, error }`. Runs identically in the
  browser (vs AI) and on the server (PvP).
- `packages/client` — Phaser 3 + Vite. Renders the **redacted view** and
  turns input into commands. Never contains rules logic.
- `packages/server` — Node + `ws`. Room codes; owns the authoritative state;
  validates every command with the shared engine; sends each player only
  their redacted view.

The client talks to games only through the `Connection` interface
(`client/src/net/Connection.ts`). `LocalAIConnection` runs the engine
in-browser; `WsConnection` talks to the server. New play modes = new
implementations of that interface.

## Invariants — do not break these

1. **The engine stays pure.** `applyCommand` never mutates its input; illegal
   commands return `{ ok: false, error }`, never throw, never change state.
2. **All rules live in `shared`.** The client may pre-check for UX (glow,
   toasts) but the engine is the authority; the server re-validates.
3. **All damage flows through `shared/src/damage.ts`** so skill hooks (Armor,
   Lifelink, Deathtouch…) apply to combat AND spells alike.
4. **Hidden information stays hidden.** Anything sent to a client goes
   through `redactFor` / `redactEvents`. Never expose opponent hand or deck
   contents in views or events.
5. **New mechanics are registry entries**, not special cases: spells/equipment
   effects via `registerEffect()` (`effects.ts`), keyword abilities via
   `registerSkill()` (`skills.ts` — capability flags for legality, hooks for
   behavior), ticking statuses via `registerStatus()` (`statuses.ts`), token
   creatures via `registerToken()` (`cards.ts` — auto-registers a summon
   effect). Rules knobs go in `RulesConfig` (`rules.ts`) and travel inside
   `GameState` so engine, AI, server, and UI agree.
6. **No hardcoded colors/fonts in scenes or objects.** Canvas styling comes
   from `client/src/theme.ts`; DOM overlay styling from the `:root` CSS
   variables in `client/index.html`.

## Where changes belong

| Change | File |
| --- | --- |
| Rules knobs / presets (incl. mulligan) | `shared/src/rules.ts` |
| Turn & phase structure | `shared/src/engine.ts` |
| Combat resolution (blockers, lanes…) | `shared/src/combat.ts` |
| League (pokemon) mode: turns, moves, prizes | `shared/src/pokemon/engine.ts` |
| League effect DSL (move/trainer ops) | `shared/src/pokemon/ops.ts` |
| League passive queries (armor, swap cost…) | `shared/src/pokemon/passives.ts` |
| League Special Conditions | `shared/src/pokemon/conditions.ts` |
| League deck legality / starter decks / demo set | `shared/src/pokemon/deck.ts`, `demo.ts` |
| Spell/equipment effects | `shared/src/effects.ts` |
| Keyword abilities (skills, triggered hooks) | `shared/src/skills.ts` |
| Statuses (poison, frozen, shield…) | `shared/src/statuses.ts` |
| Demo card catalog + tokens (`registerToken`) | `shared/src/cards.ts` |
| AI behavior | `shared/src/ai.ts` |
| Sounds (procedural + pack overrides) | `client/src/audio.ts`, `public/pack/sounds/` |
| Replay record/playback | `net/LocalAIConnection.ts`, `net/ReplayConnection.ts` |
| Reconnect / spectate / matchmaking | `server/src/Room.ts`, `server/src/index.ts`, `net/WsConnection.ts` |
| Telegram Mini App behavior | `client/src/tma.ts` |
| CI / deploy | `.github/workflows/ci.yml`, `packages/server/Dockerfile`, `netlify.toml` |
| NFT metadata -> CardDef mapping | `client/src/ton/cardMapper.ts` |
| TigerMint in-game pulls | `client/src/ton/pull.ts` + `MenuScene.ts` |
| Pack mint preflight (`npm run mint-pack`) | `scripts/mint-pack.mjs` (minting itself happens in TigerMint's Pro Wizard) |
| Local pre-mint card packs | `client/src/pack.ts`, `public/pack/` |
| Card rendering (frames, badges, full-art) | `client/src/objects/CardSprite.ts` |
| Deck builder | `client/src/scenes/DeckScene.ts` + `MenuScene.rebuildDeck()` |
| Layout positions (landscape AND portrait/TMA) | `client/src/layout.ts` |
| Board/hand/HUD layout & interactions | `client/src/scenes/GameScene.ts`, `objects/` |
| Visual effects | `client/src/objects/Fx.ts` |
| Canvas skin | `client/src/theme.ts` |
| Menu/overlay skin | `client/index.html` (`:root` variables) |
| Env configuration | `client/src/config.ts`, `.env.example` |

## Card data model

`CardDef` (in `shared/src/types.ts`) is the whole card: id, name, type
(`creature`/`equipment`/`spell`), cost, stats, `skills: [{ key, value? }]`,
`effect: { key, amount }` for spells, `art` (URL or texture key), and
`fullArt` (the image IS the card; only live badges are overlaid). Equipment
`skills` are granted to the wearer while attached. An optional `game` block
(`shared/src/pokemon/types.ts`) carries the card's League-mode definition
(stage/HP/type/trait/moves/weakness/retreat, or trainer/energy data); the
legacy fields keep the same card playable under the standard engine.

Cards come from three sources that all produce `CardDef`s: the demo catalog,
a local pack manifest (`public/pack/pack.json`, gitignored; example ships as
`pack.example.json`; optional per-card `description` flavor text and
`editions` print runs — TigerMint card sets mint as editions, so supply is
the sum of editions, not the card count), and NFT metadata via
`cardMapper.ts`. Metadata
attributes (`Type`, `Cost`, `Attack`, `Health`, `Skills`, `Spell Effect`,
`Card Style`, `Card Name`) always beat hash-derived defaults; full-art cards
never receive hash-fallback skills.

Deck shape: each owned NFT joins the deck once and the BASIC deck fills the
rest — players play day one and mint boosters to grow. Basic = the pack's
freely playable subset (`LocalPack.basicCards` in `client/src/pack.ts`):
COMMON/unset rarity is basic, RARE/EPIC/LEGENDARY are mint-only (playable
only as owned NFTs), and a per-card `basic` boolean overrides either way.
The menu's Deck Builder (`scenes/DeckScene.ts`) lets players pick instead:
NFTs capped at copies held, basic cards at 3, mint-only cards shown locked
("mint to use") until owned; picks persist per wallet in localStorage
(`tm-deck-<wallet>`) and `MenuScene.rebuildDeck()` resolves saved picks ->
NFTs+fill -> pack -> demo. Demo pulls draw from the FULL set so locked
rares still show off. `VITE_NFT_COLLECTION` and
`VITE_TIGERMINT_SLUG` are comma-separated lists: multiple collections =
multiple booster packs, and the pull panel pages between slugs with side
arrows (`switchPack` in MenuScene, `#pull-body` slide in index.html).

## Gotchas

- Cards are 3:4; art renders with center-crop (`coverCrop` in CardSprite),
  never stretched. Badge placement is `THEME.card.badges`: per style
  (framed/fullArt), each badge = anchor region + padX/padY (+ optional size).
- Branding drop-ins live in `public/pack/` (gitignored user content):
  `back.jpeg` = card back, `banner.png` = menu banner. Pull prices are always
  labeled GRAM, read from TigerMint's mint terms — never make that a config.
- Phaser pauses its loop when `document.hidden` — tweens freeze and queued
  clicks wait. In automated browser tests this masquerades as bugs.
- Two combat systems via `rules.combatStyle`: 'targeted' (attacker picks
  targets, Guard restricts) and 'blockers' (MTG-style: declare attackers ->
  'block' phase where the DEFENDER acts -> resolve; `declareBlockers` is the
  one command legal from the non-active player besides concede/mulligan;
  `actingPlayer()` in ai.ts tells whose decision the game waits on).
- A second FULL rules engine via `rules.gameMode: 'pokemon'` (League presets,
  `shared/src/pokemon/`): row[0] is the Active, the rest the Bench (+1 slot
  of headroom for Stadium bench bonuses); `life` mirrors prizes remaining;
  the `setup` phase and `promote`-after-knockout accept commands from the
  non-active player (`actingPlayer()` knows). Special Conditions tick
  BETWEEN turns inside the pokemon engine (not via tickStatuses); condition
  and self damage use `placeDamage` (bypasses W/R and armor, like damage
  counters), only move damage goes through damage.ts. Coin flips advance
  `state.rngCursor` — never `Math.random`. Legacy `skills` are stripped from
  board defs in this mode; behavior comes only from the `game` block. Deck
  searches and "you may" choices auto-pick deterministically (no choice UI).
- The design space is chosen ONCE at boot from window orientation
  (`layout.ts`: landscape 1920×1080, portrait 810×1440 for phones/Telegram
  Mini Apps). All scene positions come from layout.ts; Hud/HandLayout take
  geometry params. Portrait battle rows WRAP into a 3-column grid
  (ROW_CARD.cols/rowGap, RowLayout.slotY) for big cards; the turn banner
  sits on the battle line. The portrait menu is ONE page: the pull panel is
  a bottom sheet (`.sheet-open` on #pull-panel) behind the pulsing
  #pull-sheet-toggle ▲; its ✕ closes the sheet (the desktop hide/show
  localStorage pref is desktop-only).
- The server runs TS via `tsx`; shared package is consumed as source.
- Webfonts load in `index.html`; `BootScene` waits for `document.fonts`
  before starting scenes so Phaser doesn't rasterize fallback fonts.
- `GameScene` re-renders everything from the view on each update; layouts
  diff internally for animations. Effects that outlive a render are spawned
  as standalone objects in `Fx.ts` / `playEventEffects`.
- PowerShell `Get-Content | Set-Content` corrupts the UTF-8 in these files
  (em dashes, emoji, skill icons). Use proper editing tools.
