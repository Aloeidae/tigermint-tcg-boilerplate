# Tigermint TCG Boilerplate

A complete, hackable trading card game engine where **TON NFTs become playable
cards**. Fork it, reskin it, rewrite the rules — this is a foundation for
building *your* card game, not a finished one.

https://github.com/user-attachments/assets/c8e13b52-239c-47be-96e3-fae6c5c3633a

Connect a TON wallet and your minted cards join your deck. No wallet? The
basic deck loads and the game plays anyway. Battle a local AI or another
player in real time, with Magic-style turns, keyword skills, equipment,
spells, and selectable rule sets.

**Sections**

1. [Quick start](#1-quick-start)
2. [What's in the box](#2-whats-in-the-box)
3. [How it's put together](#3-how-its-put-together)
4. [Cards: from images to gameplay](#4-cards-from-images-to-gameplay)
5. [Decks: basic cards, minted cards, deck builder](#5-decks-basic-cards-minted-cards-deck-builder)
6. [Minting on TigerMint](#6-minting-on-tigermint)
7. [In-game pulls](#7-in-game-pulls)
8. [Skills, statuses, effects, and rules](#8-skills-statuses-effects-and-rules)
9. [Multiplayer: matchmaking, spectating, reconnects, replays](#9-multiplayer-matchmaking-spectating-reconnects-replays)
10. [Skinning & sound](#10-skinning--sound)
11. [Make it yours](#11-make-it-yours)
12. [Going to production](#12-going-to-production)

---

## 1. Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # game client  -> http://localhost:8080
npm run dev:server   # PvP server   -> ws://localhost:8081  (separate terminal)
```

Open http://localhost:8080 and hit **Play vs AI**. For PvP, open two browser
windows: **Create PvP Room** in one, enter the code and **Join Room** in the
other. The room creator's rules preset governs the match.

```bash
npm test             # engine test suite
npm run typecheck    # strict TypeScript across all packages
npm run build        # production client build
```

Everything runs with zero configuration — demo cards, demo deck, local AI.
Configuration (`packages/client/.env.example`) comes in when you connect a
real collection.

## 2. What's in the box

- **Your NFTs are your deck** — TonConnect login, wallet NFT fetch, and a
  mapper that turns any collection into playable cards. Purpose-built
  collections control everything through metadata.
- **Basic deck + boosters** — commons are free for everyone; rares and up are
  playable only by minting them. Players battle from day one and pull to grow.
- **Deck builder** — hand-pick your 30 from owned cards and the basic set,
  with rarity glows and per-wallet saved decks.
- **Play vs AI** in the browser, or **real-time PvP** — automatic matchmaking
  or 4-letter room codes, spectators, a 30-second reconnect grace window, and
  a server-authoritative engine that hides your opponent's hand.
- **In-game pulls** — a menu panel blind-pulls from your TigerMint drop
  through the player's own wallet, singles or ×5/×10 boosters, and reveals
  the cards front and center.
- **Modular skills, statuses, and rules** — register a keyword ability, a
  ticking status (Poison, Frozen, Shield), or a token summon in one place and
  cards, metadata, the engine, the AI, and the UI all pick it up; rule
  presets (with mulligans) switch whole game feels from a dropdown.
- **Replays** — the engine is a pure seeded reducer, so a finished game
  downloads as a small JSON file that plays back perfectly.
- **Sound with zero assets** — procedural WebAudio defaults for every game
  event; drop audio files in `public/pack/sounds/` to replace them.
- **Telegram Mini App ready** — ships with the TMA bridge; register a bot,
  point it at your deploy, done.
- **Two card styles** — a drawn frame around your art, or the NFT image as
  the entire card.
- **Two-file skinning** — the canvas skin in `theme.ts`, the menu skin in
  `index.html` CSS variables. Defaults follow the TigerMint design system.
- **Zero art required** — cards, board, and effects draw procedurally; drop
  in art whenever you're ready.

## 3. How it's put together

```
packages/
├── shared/   The game. Pure TypeScript, zero dependencies, no rendering.
│             Runs identically in the browser (vs AI) and on the server (PvP).
├── client/   Phaser 3 + Vite. Renders the game and turns input into commands.
└── server/   Node + ws. Room codes, authoritative engine, per-player views.
```

The engine is a pure reducer. Commands are the only way to change a game, and
every change is validated:

```ts
const { state } = createGame({ decks, names, rules, seed });
const result = applyCommand(state, { type: 'playCard', player: 0, instanceId, slot: 2 });
// { ok: true, state, events }  or  { ok: false, error }
```

The client never sees rules logic — it renders a **redacted view** (your
hand, both rows, only *counts* of hidden zones) and listens to **events** for
the battle log and effects. AI opponent or human over the wire is invisible
to the UI: both implement the same small `Connection` interface
(`client/src/net/`). Implement it again and you have hotseat, replays, or
bot-vs-bot.

The repo also ships a [`CLAUDE.md`](CLAUDE.md) written for AI coding
assistants — architecture, invariants, and where each kind of change belongs.

## 4. Cards: from images to gameplay

### NFT metadata → card

`client/src/ton/cardMapper.ts` is **the** file to make your own. The default
works with any collection: it hashes each NFT's address, so the same NFT is
always the same card, and derives type, cost, and stats from the hash.
Metadata always wins over the hash — a collection minted with game attributes
maps 1:1:

| Attribute | Effect |
| --- | --- |
| `Type` | `creature` / `equipment` / `spell` |
| `Cost`, `Attack`, `Health` | The card's numbers |
| `Skills` (or `Abilities`) | e.g. `"Haste, Armor 2"` — matched against the skill registry by name |
| `Spell Effect` | e.g. `"damage 3"`, `"aoe damage 2"` — matched against the effect registry |
| `Card Style` | `framed` or `full art` (see below) |
| `Rarity` | Pull-weight tier; tints the deck builder glow |

Filenames never matter for minted NFTs — each item's metadata binds the image
to its attributes, and that's all the mapper reads.

### Framed vs full-art

- **Framed** (default): the system draws the frame, name banner, skill line,
  and stat gems; the NFT image fills the art window.
- **Full art**: the NFT image is the whole card. Only live values are
  overlaid (cost, current stats) — everything else is your art. Skills come
  **only** from metadata for these cards, so the card always does exactly
  what its art says.

Cards are **3:4** — the most common AI-generation aspect ratio — so generated
art drops in pixel-perfect. Other ratios center-crop, never stretch. Set the
default with `VITE_CARD_STYLE`, or per-NFT with a `Card Style` attribute.

### Test a pack before minting

Drop card images plus a `pack.json` manifest into
`packages/client/public/pack/` and the game plays them immediately — no
chain, no wallet. The manifest mirrors the NFT attributes above (same names,
skills, effects) plus per-card `rarity`, optional `description` flavor text,
optional `editions` print runs, and optional `basic` (next section), so a
pack that plays well locally mints 1:1. Copy `pack.example.json` in that
folder as your starting point; your own `pack.json` and images are
gitignored, so your pack stays yours.

## 5. Decks: basic cards, minted cards, deck builder

Decks are 30 cards, assembled from two pools:

- **The basic deck** — free for every player. By default that's your pack's
  **COMMON** cards (and any card without a rarity). It fills every deck slot
  that minted cards don't.
- **Minted cards** — each NFT the wallet holds joins the deck once. **RARE,
  EPIC, and LEGENDARY cards are mint-only**: they exist in the set, show
  locked in the deck builder, and become playable only by pulling them.

A per-card `"basic": true/false` in `pack.json` overrides the rarity rule
either way — keep a rare free, or make a common mint-only.

So a new player battles instantly on an all-commons deck, and every pull
genuinely upgrades them. No wallet at all still works: the basic deck loads.

The menu's **Deck Builder** lets players pick instead of auto-filling: the
**Owned Cards** row (one copy per token held) and the **Basic Deck** row (up
to 3 copies each), with rarity-tinted glows and mint-only cards grayed out
until owned. Left-click adds a copy, right-click removes, and unpicked slots
still fill from the basic deck so a partial deck is always legal. Picks
persist per wallet in the browser and win over the automatic deck until
reset.

## 6. Minting on TigerMint

The recommended launchpad is **[TigerMint](https://mint.tendytiger.lol)** —
no-code blind mints on TON. Blind mints and card games are a natural pair:
minting **is** opening a booster pack. (TigerMint launches all kinds of
collections; card sets are one great fit.)

Minting happens on TigerMint itself — cover, banner, description, socials,
phases, allowlists all live there — and the game connects to the deployed
collection. Start with:

```bash
npm run mint-pack
```

It preflights your local pack (manifest shape, images, aspect ratios, rarity
tiers, edition totals — warnings, never blockers) and opens the
**[card-set wizard](https://mint.tendytiger.lol/project/submit?template=cards)**,
which accepts **`pack.json` itself** as the manifest — the same file you
playtested with. CSV works too. Worth knowing:

- **Card sets mint as editions**: each card is one design with a print run
  (`editions` per card; rarity-tier defaults when absent). Total supply is
  the sum of editions, and the same card landing in many wallets is booster
  behavior, not a glitch.
- Set an explicit `rarity` (`LEGENDARY/EPIC/RARE/COMMON`) per card so
  pull-weight tiers — and which cards are mint-only in the game — are
  deliberate.
- `description` (≤500 chars) mints as the item description and doubles as
  the card's flavor text locally.

Once deployed, the collection's TigerMint dashboard shows a **"Connect your
game"** card with ready-to-paste env lines — drop them into
`packages/client/.env.local` (plus a `VITE_TIGERMINT_API_KEY` from the
[developers page](https://mint.tendytiger.lol/developers)) and holders'
wallets become their decks.

**Ship booster packs by adding collections.** `VITE_NFT_COLLECTION` and
`VITE_TIGERMINT_SLUG` both take comma-separated lists: cards from every
listed collection join decks, and with several slugs the pull panel grows
**‹ ›** arrows that page between your drops.

## 7. In-game pulls

The menu has a hideable **"Pull a card"** panel — a portrait widget showing
the collection cover, live phase, supply bar, and the **pull price in GRAM**
(read from TigerMint's mint terms, deliberately not configurable). One click
blind-pulls through the player's own connected wallet: eligibility check,
signed voucher, wallet transaction, then the landed cards are confirmed and
revealed front and center — the menu fades while each card flips over to its
actual minted art — and the player's deck refreshes with them. Every phase,
price, and wallet cap is enforced server-side.

**Boosters:** ×1 / ×5 / ×10 pills set the pull size (capped by the drop's
per-wallet and supply limits — one wallet transaction either way), the
button always shows the wallet-exact total, and a multi-pull reveal fans the
cards out as they flip.

**Unconfigured, the panel runs in demo mode** — it flip-reveals a random
card from the full set (mint-only rares included, that's the show) so the
experience is on display from the first `npm run dev`. `VITE_PULL_PANEL=hidden`
starts the panel collapsed; players can hide or show it either way, and
their choice is remembered.

## 8. Skills, statuses, effects, and rules

### Keyword skills

`shared/src/skills.ts` is a registry of keyword abilities (Haste, First
Strike, Guard, Lifelink, Armor, Deathtouch, Regenerate, Venomous, Scavenger,
Inspiring ship as examples). A skill declares **flags** for legality
(`grantsSummonReady`, `guards`, `strikesFirst`) and **hooks** for behavior
(`onSummon`, `onTurnStart`, `onEndTurn`, `onDraw`, `onAllyDeath`, `onDeath`,
`modifyDamageDealt`, `modifyDamageTaken`, `afterDealDamage`). All damage —
combat and spells — flows through one pipeline, so hooks apply everywhere.

```ts
registerSkill({
  key: 'thorns',
  name: 'Thorns',
  icon: '🌵',
  describe: (v) => `Attackers take ${v} damage back.`,
  hooks: {
    modifyDamageTaken: (amount, ctx) => {
      if (ctx.other && !ctx.attacking) ctx.other.health -= ctx.value;
      return amount;
    },
  },
});
```

That's a complete new mechanic: `{ key: 'thorns', value: 2 }` now works on
any card, renders on the frame, floats a trigger popup in game, and NFT
metadata can reference it by name. Skills on **equipment** are granted to
the wearer. Renaming keeps the mechanics and changes the flavor:

```ts
configureSkill('haste', { name: 'Charge', icon: '🐎' });
```

### Statuses & counters

`shared/src/statuses.ts` is the same registry idea for **ticking conditions
that sit on a creature**: Poison (damage every turn), Frozen (can't attack
for a turn), Shield (absorbs the next N damage) ship as examples. A status
declares a legality flag (`blocksAttack`) and hooks (`onTurnStart`,
`modifyDamageTaken`); the board renders each creature's status icons, and
spells apply them via effects (`"Spell Effect: poison 2"`, `freeze`,
`shield 3`) while skills apply them from hooks (Venomous poisons whatever it
damages). `registerStatus()` + one effect and your new condition works from
NFT metadata immediately.

### Spell & equipment effects

`shared/src/effects.ts` is the same idea for one-shot effects: `damage`,
`aoe damage`, `heal`, `draw`, `buffAttack`, the status appliers, and token
summons ship as examples; `registerEffect()` adds yours, and `Spell Effect`
metadata references them by name.

**Tokens:** `registerToken()` (cards.ts) registers a creature that exists
only when summoned — and auto-registers its `summon <Name> N` effect, so
`"Spell Effect: summon squirrel 2"` works from any card or NFT the moment
the token exists (the demo's Acorn Call does exactly that).

### Rules presets

Draw → Main → Combat → Second Main → End. The **Rules** dropdown switches
presets from `shared/src/rules.ts`:

| Knob | What it does |
| --- | --- |
| `startingLife`, `deckSize`, `openingHand`, `maxHand`, `maxRow`, `manaCap` | The numbers |
| `firstPlayerDraws` | Does the starting player draw on turn 1? |
| `summoningSickness` | Can creatures attack the turn they're played? |
| `attacksPerTurn` | Attacks per creature per turn |
| `mustAttackCreaturesFirst` | All enemy creatures guard their player |
| `retaliation` | Do defenders strike back? |
| `fatigue` | Empty-deck draw: lose instantly, or take growing damage |
| `mulligan` | Each player may shuffle back their opening hand once (free redraw) |
| `combatStyle` | `targeted` (pick each attack's target) or `blockers` (MTG-style: attacks aim at the player, the defender declares blockers, unblocked damage goes face) |

Add an entry to `RULE_PRESETS` and it appears in the menu. Rules travel
inside the game state, so the engine, AI, server, and targeting UI always
agree.

## 9. Multiplayer: matchmaking, spectating, reconnects, replays

- **Find Opponent** queues you server-side; the first two players on
  identical rules become a match. Room codes still work for playing a
  specific friend.
- **Spectate** (the 👁 button) joins any room by its code as a watcher —
  spectators get a no-hidden-information view (both hands as counts) and
  can never send commands.
- **Reconnects:** a dropped socket holds your seat for 30 seconds — the
  client retries automatically, a page refresh resumes via the seat token in
  sessionStorage, and your opponent sees "holding their seat…" instead of an
  instant win.
- **Replays:** vs-AI games record themselves (setup + command log — the
  pure seeded engine replays them exactly). The game-over screen offers a
  ⬇ Replay download; **▶ Watch a replay** on the menu plays any saved file
  back with SPACE to pause.

## 10. Skinning & sound

The whole look lives in two token files, both built to be swapped wholesale.
The default follows the TigerMint design system (black, hairline borders,
`#f97316` orange, Lilita One / Inter / JetBrains Mono):

- **`client/src/theme.ts`** — everything the canvas draws: backgrounds, card
  frames and type tints, HUD, glows, rarity colors, damage numbers, fonts,
  and **badge placement** (`card.badges`: each of cost/attack/health/equip
  names one of nine anchor regions plus `padX`/`padY` fine-tuning, per card
  style — so the gems can sit anywhere, and full-art cards get deeper
  defaults to clear painted borders).
- **`client/index.html`** — the DOM overlay's `:root` CSS variables (accent
  family, panels, text tiers, radii, easing) plus the Google Fonts `<link>`
  if you swap font families.

Art drop-ins need no code: `public/pack/back.jpeg` becomes the card back
everywhere; `public/pack/banner.png` replaces the menu title with your banner
graphic; preload `bg-menu` / `bg-board` textures in `BootScene.ts` to replace
the procedural backdrops. All art renders aspect-correct via center-crop.

**Sound** works the same way (`client/src/audio.ts`): every game event maps
to a key with a procedural WebAudio default — the game is audible with zero
bundled files. Drop `public/pack/sounds/<key>.mp3` (`summon`, `attack`,
`victory`, `pull`, …) to replace any of them; the 🔊 button on the menu
mutes, remembered per browser.

## 11. Make it yours

| I want to… | Edit |
| --- | --- |
| Canvas colors, fonts, glows, foils, badge placement | `client/src/theme.ts` |
| Menu overlay skin (CSS variables) | `client/index.html` |
| Map my collection's metadata to cards | `client/src/ton/cardMapper.ts` |
| Add or rename keyword abilities | `shared/src/skills.ts` |
| Add statuses (poison, frozen…) | `shared/src/statuses.ts` |
| Add spell/equipment effects | `shared/src/effects.ts` |
| Add token creatures | `registerToken()` in `shared/src/cards.ts` |
| Add or replace sounds | `client/src/audio.ts`, `public/pack/sounds/` |
| Tune or add rules presets | `shared/src/rules.ts` |
| Change combat (blockers, lanes…) | `shared/src/combat.ts` |
| Change turn/phase structure | `shared/src/engine.ts` |
| Rebalance the demo cards | `shared/src/cards.ts` |
| Smarter (or dumber) AI | `shared/src/ai.ts` |
| Which cards are free vs mint-only | `rarity` / `basic` in `pack.json` |
| The deck builder | `client/src/scenes/DeckScene.ts` |
| Action effects (numbers, bursts, banners) | `client/src/objects/Fx.ts` |
| Layout, drag & targeting behavior | `client/src/scenes/GameScene.ts` |
| The in-game pull panel | `client/src/ton/pull.ts`, `MenuScene.ts` |
| The pack preflight (`npm run mint-pack`) | `scripts/mint-pack.mjs` |
| Card back / banner / backgrounds | `public/pack/`, preload in `BootScene.ts` |

## 12. Going to production

**Deploying:** CI ships in `.github/workflows/ci.yml` (test, typecheck,
build on every push). The client is a static build — `netlify.toml` is
ready for Netlify and the same shape works on any static host; set your
`VITE_*` env in the host's dashboard. The PvP server has a `Dockerfile`
(`docker build -f packages/server/Dockerfile -t tcg-server .`) for any
container host; point `VITE_SERVER_URL` at it (`wss://` behind TLS).

**Telegram Mini App:** the TMA bridge is already wired (`client/src/tma.ts`
— no-op outside Telegram), and the game is **fully playable in portrait**:
on any portrait window (phones, Mini Apps) it boots into a dedicated
810×1440 design space — stacked battle rows, compact HUD, touch-sized hand
cards, a stacked menu — chosen at startup in `client/src/layout.ts` (every
position lives there; retune the layout without touching scene code).
Deploy the client, then in @BotFather create a bot → Bot Settings →
Configure Mini App → your deploy URL. Set `VITE_TWA_RETURN_URL` to the
app's `https://t.me/yourbot/yourapp` link so TON wallets hop back into
Telegram after signing.

A few things stay intentionally simple:

- **Decks are client-submitted and trusted.** For real stakes, verify NFT
  ownership server-side: prove the wallet via TonConnect, query the chain
  from the server, and re-derive decks with the same mapper (note in
  `server/src/Room.ts`).
- **Rooms and the matchmaking queue live in memory** — a server restart
  drops games.
- Serve the client over HTTPS with a real
  [TonConnect manifest](https://docs.ton.org/develop/dapps/ton-connect/manifest);
  wallets require it outside localhost.

## License

MIT — see [LICENSE](LICENSE). Build something fun with it.
