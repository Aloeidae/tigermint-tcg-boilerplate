# Plugging Sticker League into the Tigermint TCG boilerplate

This is the gap analysis between the boilerplate (Hearthstone/MTG engine) and
the Pokémon-style rules in `RULESET.md`, plus a concrete port plan. Everything
below respects the boilerplate's invariants: pure reducer, all rules in
`packages/shared`, registries not special cases, redacted views.

## 1. What the boilerplate already gives you (keep)

| Boilerplate | Reuse for |
| --- | --- |
| Pure `applyCommand` reducer + seeded PRNG (`mulberry32`) | Coin flips, shuffles, replays — flips are `rng() < 0.5` on a per-command derived seed |
| `damage.ts` single pipeline + `modifyDamageDealt/Taken` hooks | Weakness/Resistance/Traits/Gifts all go through here |
| `skills.ts` registry (flags + hooks) | **Traits** — rename the registry entries, keep the mechanism |
| `statuses.ts` (Poison/Frozen/Shield, `onTurnStart`, `blocksAttack`) | **Special Conditions** — Spammed ≈ Poison, Muted/Lagging ≈ Frozen with flip-to-cure |
| `effects.ts` registry + `findEffectKey()` name matching | **Bots / Admins / Channels / Move text** |
| Equipment (`equipment[]` on a creature, granted skills) | **Gifts** (cap 1 per Sticker) and **Reactions** (attached cards, no cap) |
| `rules.ts` presets travelling in state | `standard` (60/7/6 Stars/Chat 5) and `quick` (30/5/3 Stars/Chat 3) presets |
| `redact.ts` | Add `starsCount`, `chat`, attached Reactions (public), keep hand hidden |
| `pack.ts` / `cardMapper.ts` | Already tolerant of extra keys — `out/pack.json` loads as-is today |
| TMA bridge, portrait layout, PvP server, replays, deck builder, pulls | Untouched |

## 2. What has to change (the actual port)

Ordered by dependency. Each step keeps `npm test` green.

### 2.1 `types.ts` — card model
Add a `game?: StickerCard` block to `CardDef` (see `engine/types.sticker.ts`).
The legacy `type/cost/attack/health` stay so the untouched client still renders
badges; the new engine ignores them.

`CreatureOnBoard` → keep the name (client depends on it) but add:
```ts
damage: number;            // damage counters ×10 (HP stays on def.game.hp)
reactions: CardInstance[]; // attached Reaction cards (public info)
gift: CardInstance | null; // one Gift max
stack: CardDef[];          // upgrade history (Static under Animated under Premium)
enteredTurn: number;       // for "can't upgrade the turn it was played"
conditions: StatusRef[];   // Special Conditions (Pinned only)
```
`PlayerState` → add `stars: CardInstance[]` (face-down prizes), `starsTaken: number`,
`reactionAttachedThisTurn`, `adminPlayedThisTurn`, `swappedThisTurn`. Reuse
`row[0]` as **Pinned** and `row[1..maxRow]` as **Chat** — this keeps the
client's row rendering working before you restyle it. `GameState` → add
`channel: CardInstance | null` (shared Stadium) and `rngCursor` for flips.

### 2.2 `rules.ts` — presets
```ts
standard: { deckSize: 60, openingHand: 7, maxRow: 6 /* 1 pinned + 5 chat */, stars: 6,
            firstPlayerDraws: true, firstTurnNoAttack: true, firstTurnNoAdmin: true,
            manaCap: 0, retaliation: false, summoningSickness: false, combatStyle: 'targeted',
            mulligan: false, fatigue: 'lose', maxHand: 99, starStickerStars: 2 }
quick:    { ...standard, deckSize: 30, openingHand: 5, maxRow: 4, stars: 3,
            firstPlayerDraws: false, firstTurnNoAdmin: false }
```
`mergeRules` gets the new knobs (`stars`, `firstTurnNoAttack`, `firstTurnNoAdmin`,
`starStickerStars`). Mana is unused: `manaCap: 0` and the client hides the gem.

### 2.3 `commands.ts` — new commands
```ts
| { type: 'playSticker';   player; instanceId; slot? }                  // Static to Chat (or Pinned if empty)
| { type: 'upgrade';       player; instanceId; targetInstanceId }       // Animated/Premium onto a Sticker
| { type: 'attachReaction';player; instanceId; targetInstanceId }       // once per turn
| { type: 'attachGift';    player; instanceId; targetInstanceId }
| { type: 'playTrainer';   player; instanceId; target?: EffectTarget; choices?: unknown } // Bot/Admin/Channel
| { type: 'useTrait';      player; instanceId; target?: EffectTarget }  // oncePerTurn traits
| { type: 'swap';          player; targetInstanceId }                   // Pinned <-> Chat, pays Swap cost
| { type: 'move';          player; moveIndex: 0 | 1; target?: EffectTarget } // attack; ends the turn
| { type: 'promote';       player; targetInstanceId }                   // pick new Pinned after a KO (non-active player may send)
| { type: 'setup';         player; pinnedId; chatIds: string[] }        // opening placement
```
`playCard`/`attack`/`declareBlockers` are removed from the Sticker preset;
keep them behind `rules.combatStyle === 'pokemon'` gating if you want both
engines to coexist in one repo. `promote` and `setup` join `mulligan`/`concede`
as commands legal from the non-active player.

### 2.4 `engine.ts` — turn structure
- `startTurn`: reset per-turn flags, draw (respect `firstPlayerDraws`), then
  **between-turns checks happen at end of the previous turn**: tick Spammed/
  Flamed, flip for Muted/Flamed cure, clear Lagging on the owner's turn end.
- `move` command: validate cost coverage (`coversCost(reactions, move.cost)`
  — typed Reactions match type, `Neutral` cost accepts anything, Special
  Reactions use `provides`), check Muted/Lagging (`blocksAttack` flag), run
  Glitched flip, resolve damage via `damage.ts`, run the move's `effects`
  through the effect DSL interpreter, sweep KOs, award Stars, request
  `promote` if the defender's Pinned died, then `startTurn(other)`.
- KO sweep (`helpers.sweepDeaths`): `damage >= hp` → KO. Archive the stack,
  Reactions and Gift; opponent takes `starsOnKO` Stars into hand; `checkWin`
  handles "no Sticker to promote" and "last Star taken".
- Turn-1 rules from `rules.firstTurnNoAttack` / `firstTurnNoAdmin`.

### 2.5 `damage.ts` — weakness/resistance
Insert between attacker-side and defender-side hooks:
```ts
if (!ctx.ignoreWR) {
  if (defender.def.game.weakness === attackerType && !hasFlag(defender,'noWeakness')) amount *= rules.weaknessMultiplier;
  if (defender.def.game.resistance === attackerType) amount = Math.max(0, amount - rules.resistanceAmount);
}
```
Bench damage and condition damage set `ignoreWR: true`. Store damage in
tens internally (`amount / 10`) if you keep the integer `health` badge.

### 2.6 `statuses.ts` — Special Conditions
Register `spammed` (tick 10, amount overridable), `flamed` (tick 20 + flip to
cure), `muted` (blocksAttack, blocksSwap, flip to cure), `lagging` (blocksAttack,
blocksSwap, clears end of owner's next turn), `glitched` (pre-attack flip,
tails = 30 self damage + move fails). Add the `blocksSwap` flag. Only the
Pinned Sticker may carry them; `swap`/`upgrade` clear them (`clearConditions`).

### 2.7 `skills.ts` — Traits
Every `trait.key` in `data/traits.json` becomes a `registerSkill` entry; the
`effects` on each trait tell you which hook to implement (table in §4).
Add hooks the boilerplate lacks: `onAttach`, `onKOOpponent`, `modifySwapCost`,
`onPlayFromHand`. `configureSkill()` renames stay available for flavor.

### 2.8 `effects.ts` — effect DSL interpreter
Instead of one handler per card, register **one handler per DSL op** (§4) and
give `effects.ts` an `runEffects(list, ctx)` that walks a card's `effects`
array. Move text, Traits and Trainers all share it, and NFT metadata can carry
the DSL as a JSON string in a `Game Effects` attribute (or the mapper rebuilds
it from `out/cards.json` by card id — recommended: ship `cards.json` with the
client and map NFT → id via the `Card Name`/`id` attribute).

### 2.9 `ai.ts`
Simple greedy policy is enough for v1: attach a Reaction to the Sticker whose
next Move it completes; play Statics until the Chat is full; upgrade when
possible; Swap if Pinned is about to die and a Chat Sticker can attack; pick
the highest-`expectedDamage` affordable Move, preferring KOs and weakness.

### 2.10 Client
- `GameScene`: slot 0 becomes the Pinned spot, slots 1–5 the Chat; hide mana;
  render Reaction pips (emoji) and a damage counter overlay (`hp - damage`).
- `CardSprite`: badges → HP top-right, Move rows, Swap cost bottom-right, type
  emoji top-left; Weakness/Resistance footer. `THEME.card.badges` already
  allows anchor placement, so it is mostly theme work.
- `Hud`: Stars remaining for both players.
- `cardMapper.ts`: read `Card Kind`, `Stage`, `Reaction Type`, `HP`, `Move N *`,
  `Weakness`, `Resistance`, `Swap Cost`, `Upgrades From` attributes, falling
  back to `cards.json` lookup by `Card Name`.

## 3. Deck legality (`shared/src/deck.ts`, new)
- `deckSize` exact; ≥1 Static or Star Sticker; ≤4 copies by name (Basic
  Reactions unlimited); ≤4 Special Reactions total; an Animated/Premium requires
  its `upgradesFrom` card to be present (warn, don't block).
- The deck builder already caps basics at 3 copies; raise to 4 for Sticker
  League and add the unlimited-Reactions exception.

## 4. Effect DSL reference

Every `op` below appears in `data/*.json`. `side` defaults to the card's owner;
`target` is resolved from the command's `target` when the op needs a choice.

| op | Fields | Meaning |
| --- | --- | --- |
| `status` | status, amount?, target? | Apply a Special Condition (default: opponent's Pinned). `amount` overrides tick damage. |
| `flipStatus` | status | Flip; heads → `status`. |
| `flipBonus` | bonus | Flip; heads → +bonus damage this Move. |
| `flipDamage` | flips, perHeads | Damage = perHeads × heads. Base damage is 0. |
| `benchDamage` | amount, targets | Damage to N Chat Stickers, ignores W/R. |
| `selfDamage` | amount, when? | Damage to the attacker (or wearer on `onAttach`). |
| `discardEnergy` | from (`self`/`target`), count | Discard Reactions. |
| `heal` | amount, target (`self`/`all`/`active`/`choose`) | Remove damage. |
| `draw` | count | Draw cards. |
| `drawTo` | count, ifBehind? | Draw until hand size = count (or `ifBehind` when behind on Stars). |
| `lockSwap` | — | Target can't Swap next turn. |
| `priority` | — | Move usable the turn the Sticker was played. |
| `searchEnergy` | count, type (`own`/name), attachTo (`self`/`bench`) | Feed search + attach. |
| `search` | filter, count | Feed search to hand (`filter`: stage/kind/special). |
| `searchToBench` | filter, count | Feed search onto the Chat. |
| `searchEvolve` | — | Feed search for an upgrade of a Sticker in play; upgrade now. |
| `lookTop` | count, take | Look at top N, take one matching `take`. |
| `recover` / `recoverAttach` | filter, count | From Archive to hand / attach. |
| `moveEnergy` | count | Move Reactions between own Stickers. |
| `shuffleHandDraw` / `opponentShuffleHandDraw` | count | Hand → Feed, draw N. |
| `discardHand` | — | Discard hand. |
| `revealHand` | — | Opponent reveals hand (event, redact-safe). |
| `opponentShuffleFromHand` | filter, count | Pick from revealed hand, shuffle into their Feed. |
| `gust` | — | Force opponent's Pinned ↔ Chat, you choose. |
| `switchSelf` | — | Your Pinned ↔ Chat, free. |
| `reduceDamageNextTurn` | amount | Defender-side damage reduction next turn. |
| `protect` | scope | Prevent all Move damage next turn. |
| `bonusPerBench` | amount, side | +amount per Sticker on your Chat. |
| `bonusPerPrizeTaken` | amount, side | +amount per Star the given side has taken. |
| `bonusVs` | amount, filter | +amount vs matching defenders (Star/Premium). |
| `buffDamage` | amount, duration (`turn`/`attached`) | Temporary +damage. |
| `copyMove` | — | Use one of the opponent's Pinned Moves. |
| `taunt` | — | Enemy Moves must target the bearer (Trait). |
| `thorns` | amount | Damage the attacker when damaged. |
| `armor` | amount | Reduce Move damage taken. |
| `benchImmune` | — | No Move damage while on the Chat. |
| `statusImmune` / `statusLock` / `statusAmplify` / `statusHarder` | status, amount/flips | Condition modifiers. |
| `noWeakness` | — | Remove Weakness. |
| `swapCost` / `swapCostDelta` / `opponentSwapCost` | value / delta, filter | Swap cost modifiers. |
| `extraAttach` | scope, matchType?, side | An extra Reaction attachment. |
| `peekTop` | count | Look at top card, may bottom it. |
| `hpBonus` | amount | +HP (Gift). |
| `drawOnDamaged` | count | Draw when the wearer is damaged. |
| `moveAllEnergyOnKO` | to | Move Reactions to a Chat Sticker on KO. |
| `benchSize` | delta, side | Chat capacity modifier (Channel). |
| `limitKind` / `lockKind` | kind, perTurn | Per-turn card-kind limits. |
| `conditionalDraw` | condition, side | Once-per-turn conditional draw (Channel). |
| `millDrawPer` | count, filter | Discard top N, draw per match. |
| `flip` | heads[], tails[] | Branch on a coin flip. |
| `condition` | prizesTaken… | Play restriction (validate in `playTrainer`). |
| `discardSelf` | when | Self-discard trigger (Premium Boost). |
| `noAttack` | scope | Target can't attack this turn. |
| `discardTool` | target | Discard a Gift. |

## 5. Suggested "light LLM work"
The generator produces mechanically sound but generic **flavor text** and
**move names**. Two cheap passes with Claude (Sonnet is fine) fix that:

1. **Flavor**: for each card in `out/cards.json`, prompt with the sticker
   pack title, the character, the type identity and the moves; ask for one
   ≤120-character line in the sticker's voice. Write to `data/overrides.json`
   as `{ "<id>": { "description": "..." } }` so re-generation keeps it.
2. **Naming**: same for `moves[].name` and the Animated/Premium card names
   (e.g. "Premium Utya" → "Utya Deluxe"). Keep `cost`/`damage`/`effects`
   untouched so balance survives.

Both are pure string fields: they never touch balance, and `overrides.json`
is applied last by the generator.

## 6. Art
`art` is `<card id>.png`. Telegram stickers are WebP (static), TGS (Lottie)
or WebM (video). For static packs, `getStickerSet` via the Bot API gives file
ids → `getFile` → WebP → resize/pad to 3:4 (cards are 3:4 in the boilerplate).
For animated packs, render one frame with `lottie` / `ffmpeg`. Stage art =
different stickers from the same pack (Static: neutral pose, Animated: action,
Premium: the pack's most dramatic sticker). IP note: sticker art belongs to
its creators — the Telegram official packs are used liberally by third
parties but confirm licensing before minting them as NFTs.
