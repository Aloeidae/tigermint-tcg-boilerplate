# Sticker League — Official Ruleset v0.1

A Pokémon-TCG-style battle game where Telegram sticker packs are the fighters.
Mechanically it is the Pokémon TCG (Active/Bench, energy attachment, HP with
damage, evolution, prizes, weakness/resistance, retreat, Items/Supporters/
Stadiums/Tools) with everything renamed into Telegram vocabulary.

The mapping table at the end lists every Pokémon term next to its Sticker
League name so anyone who knows Pokémon can play in five minutes.

---

## 1. Card types

| Sticker League | Pokémon equivalent | Notes |
| --- | --- | --- |
| **Sticker** | Pokémon | The fighters. One card line per Telegram sticker pack. |
| **Reaction** | Energy | Attached to a Sticker to power its Moves. Eight typed Reactions + Neutral. |
| **Bot** | Item | Play any number per turn. |
| **Admin** | Supporter | One per turn. Powerful. |
| **Channel** | Stadium | Stays in play, affects both players, replaced by a new Channel. |
| **Gift** | Pokémon Tool | Attach to a Sticker; one Gift per Sticker. |

## 2. Reactions (types)

Every Sticker and every typed Reaction has one of eight **Reaction types**
(Telegram reactions). Neutral (👀) is the ninth: any Reaction pays a Neutral
cost, but nothing is Neutral-typed for weakness.

| Emoji | Type | Flavor / identity | Signature status |
| --- | --- | --- | --- |
| 🔥 | Blaze | Aggro, burn, discard-to-deal-damage | Flamed |
| 🥶 | Chill | Control, big HP, snipes the Chat (bench) | — (locks Swaps) |
| ⚡ | Zap | Fast, low cost, tempo | Lagging |
| 👍 | Solid | Bruisers, high HP, high Swap cost | — (self-damage for big hits) |
| 🤯 | Mind | Tricks, sleep, energy manipulation | Muted |
| 💩 | Gross | Attrition, spam, poison | Spammed |
| ❤️ | Heart | Healing, support, protection | — (heal) |
| 😂 | Chaos | Coin flips, confusion, randomness | Glitched |
| 👀 | Neutral | Colorless — generic costs, swiss-army Stickers | — |

**Weakness / Resistance wheel** (each type is weak ×2 to the next, and resists
−20 the one two steps behind it):

```
Blaze → weak to Chill
Chill → weak to Zap
Zap   → weak to Solid
Solid → weak to Mind
Mind  → weak to Gross
Gross → weak to Heart
Heart → weak to Chaos
Chaos → weak to Blaze
```

Resistance (−20): Blaze resists Heart · Chill resists Chaos · Zap resists Blaze ·
Solid resists Chill · Mind resists Zap · Gross resists Solid · Heart resists
Mind · Chaos resists Gross. Roughly one in three Stickers has no Resistance.

## 3. Sticker cards

Every Sticker has:

| Field | Meaning |
| --- | --- |
| **Character** | The sticker-pack character (e.g. Utya). Every card in the line links to the pack. |
| **Stage** | **Static** (Basic) → **Animated** (Stage 1) → **Premium** (Stage 2). |
| **HP** | Hype Points. Reaches 0 → Knocked Out. Always a multiple of 10. |
| **Type** | One of the eight Reaction types (or Neutral). |
| **Trait** | Optional passive ability (Pokémon "Ability"). Never uses Reactions. |
| **Moves** | One or two attacks. Each has a Reaction cost, a base damage, and optional text. |
| **Weakness** | Type that deals ×2 to this Sticker. |
| **Resistance** | Type that deals −20 to this Sticker (may be none). |
| **Swap cost** | Retreat cost, in Reactions discarded (0–4). |
| **Rarity** | COMMON / RARE / EPIC / LEGENDARY. Drives mint-only status and pull weight. |

**Stages.** A Static can be played from hand onto the Chat. An Animated is
played *on top of* the matching Static; a Premium on top of the matching
Animated. The upgraded Sticker keeps attached Reactions, Gifts, and damage;
it loses all Special Conditions. A Sticker cannot upgrade on the turn it was
put into play, nor on your first turn. Upgrading skips "just played" rules for
Moves: the upgraded card may attack that turn.

**Line tiers.** Sticker packs are ranked (trending position). Rank decides the
line shape:

| Roster rank | Line | Card rarities |
| --- | --- | --- |
| 1–10 | Static → Animated → Premium | COMMON → EPIC → LEGENDARY |
| 11–40 | Static → Animated | COMMON → RARE |
| 41–90 | Standalone **Star Sticker** (no upgrades, higher HP, gives 2 Stars when KO'd) | RARE |
| 91–150 | Standalone Static | COMMON |

Star Stickers are the Pokémon-ex analogue: strong from turn one, but your
opponent takes **two** Stars when they knock one out.

## 4. The table

```
             ┌──────────┐
             │  PINNED  │   ← Active Sticker (exactly one, always)
             └──────────┘
   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
   │CHAT│ │CHAT│ │CHAT│ │CHAT│ │CHAT│   ← Bench (max 5; 3 in Quick rules)
   └────┘ └────┘ └────┘ └────┘ └────┘

   Feed (deck)   Hand   Archive (discard)   Stars (prizes, face down)   Channel (shared)
```

| Zone | Pokémon | Sticker League |
| --- | --- | --- |
| Active | Active Pokémon | **Pinned** |
| Bench | Bench | **Chat** |
| Deck | Deck | **Feed** |
| Discard | Discard pile | **Archive** |
| Prizes | Prize cards | **Stars** |
| Lost Zone | Lost Zone | **Deleted** (used by a handful of cards; irreversible) |

## 5. Setup

1. Shuffle your Feed. Draw 7.
2. If you have no Static Sticker (or Star Sticker), reveal your hand, reshuffle,
   draw 7 again; the opponent may draw 1 extra card for each time you do this.
3. Put one Static face-down as your Pinned Sticker. Optionally put up to
   5 more Statics face-down on the Chat.
4. Put the top 6 cards of your Feed face-down as your Stars.
5. Coin flip decides who goes first. Turn both players' Stickers face up.

**Quick preset** (mobile / boilerplate 30-card decks): draw 5, Chat max 3,
3 Stars, and Star Stickers give 2 of those 3.

## 6. Turn structure

The engine phases map onto the boilerplate: `draw → main → attack → end`.

1. **Draw** one card. (The first player *does* draw on turn 1 but may not
   attack on turn 1. Under Quick rules the first player skips the turn-1 draw.)
2. **Main phase**, any number of times, in any order:
   - Play Static Stickers to the Chat (Chat cap applies).
   - Upgrade Stickers (Animated onto Static, Premium onto Animated).
   - Attach **one** Reaction from hand to one of your Stickers (once per turn).
   - Play any number of Bots.
   - Play **one** Admin.
   - Play **one** Channel (replaces the current one; can't replace an
     identical Channel).
   - Attach Gifts (one per Sticker).
   - Use Traits (each Trait says when/how often).
   - **Swap** your Pinned Sticker once: discard Reactions equal to its Swap
     cost and exchange it with a Chat Sticker. Special Conditions clear when
     it moves to the Chat.
3. **Attack** with your Pinned Sticker: pay nothing extra — its attached
   Reactions must *cover* the Move's cost. Attacking ends your turn.
   You may skip attacking and end your turn instead.
4. **End of turn**: Special Conditions tick (Spammed, Flamed), then sleep /
   lag checks (Muted, Lagging) — see §9.

**Turn-1 restrictions:** the player who goes first cannot attack, play an
Admin, or upgrade on their first turn. (Quick preset: may play an Admin.)

## 7. Moves and damage

1. Check the Move's Reaction cost against Reactions attached to the attacker.
   Neutral (👀) cost is satisfied by any Reaction. Typed costs need that type
   (or a Reaction card that counts as that type).
2. Apply the Move's **base damage**, then effects that modify damage on the
   attacker's side (+X from Gifts, Traits, Channels).
3. Apply **Weakness** (×2) then **Resistance** (−20) on the defender.
4. Apply effects on the defender's side (−X from protection Traits/Gifts).
5. Place damage on the defender. Damage is tracked in 10s (the boilerplate
   tracks integer health — we store HP/10 internally, see ENGINE_INTEGRATION).
6. Any Move text resolves in order: coin flips, statuses, self-damage, Chat
   snipes, energy discards, heals, draws.

Damage from Moves to Chat (bench) Stickers ignores Weakness/Resistance
unless the Move says otherwise. Damage from Special Conditions and from
Move text that says "put damage" ignores Weakness/Resistance.

**Knock Out.** HP ≤ damage → KO. The KO'd Sticker, its Reactions and Gift go
to the owner's Archive. The opponent takes 1 Star (2 for a Star Sticker) from
their Stars into their hand. If the KO'd Sticker was Pinned, the owner promotes
a Chat Sticker immediately; no Chat → the opponent wins.

## 8. Win conditions

You win when any of these happens:

1. You take your last Star.
2. Your opponent has no Sticker to promote to Pinned.
3. Your opponent must draw from an empty Feed at the start of their turn.

If both happen for both players simultaneously (sudden death), replay with
1 Star each.

## 9. Special Conditions

Only the **Pinned** Sticker can hold Special Conditions. Swapping to the Chat
or upgrading clears them.

| Sticker League | Pokémon | Rule |
| --- | --- | --- |
| **Spammed** | Poisoned | Place 10 damage between turns. (Some Moves: 20 or 30.) |
| **Flamed** | Burned | Place 20 damage between turns, then flip: heads → cured. |
| **Muted** | Asleep | Can't attack or Swap. Between turns flip: heads → wakes. |
| **Lagging** | Paralyzed | Can't attack or Swap. Cleared at the end of the owner's next turn. |
| **Glitched** | Confused | Before attacking, flip: tails → the Move fails and it takes 30 damage. |

Marker order (for the engine): Spammed / Flamed stack with **one** of
Muted / Lagging / Glitched (the latest replaces the earlier).

## 10. Reaction cards

- **Basic Reactions** (eight): one per type. Unlimited copies in a deck.
- **Special Reactions** (limited to 4 per deck):
  - **Double Tap** (👀👀) — counts as two Neutral.
  - **Mixed Signals** — counts as any one type but the Sticker takes 10
    damage when it's attached.
  - **Premium Boost** — counts as one Reaction of the attached Sticker's
    type; +10 damage on that Sticker's Moves; discard at end of turn.

## 11. Bots, Admins, Channels, Gifts

Deck-building limits: 4 copies of any card by name (Basic Reactions
unlimited). Standard deck 60 cards; Quick deck 30 cards.

Trainers are defined in `data/trainers.json` with a small effect DSL (see
ENGINE_INTEGRATION.md). Representative cards:

| Card | Kind | Effect |
| --- | --- | --- |
| Refresh Feed | Bot | Shuffle your hand into your Feed, draw 5. |
| Ping | Bot | Search your Feed for a Static, reveal it, put it in hand, shuffle. |
| Forward Message | Bot | Move one Reaction from one of your Stickers to another. |
| Edit Message | Bot | Heal 30 damage from one of your Stickers. |
| Boost | Bot | Search your Feed for a Reaction, reveal, put in hand. |
| Group Admin | Admin | Draw 3. |
| Channel Owner | Admin | Discard hand, draw 7. |
| Moderator | Admin | Your opponent's Pinned Sticker swaps with one of their Chat Stickers of your choice. |
| Spam Filter | Admin | Your opponent shuffles their hand and draws 4. |
| Verified Badge | Admin | Search for a Sticker that upgrades one of yours and put it on it now. |
| Night Mode | Channel | All Muted checks need two heads to wake. |
| Megagroup | Channel | Both players' Chat max is 6 (Quick: 4). |
| Reaction Wall | Channel | Once per turn each player may attach an extra Reaction of their Pinned Sticker's type. |
| Premium Sticker Slot | Gift | The Sticker this is attached to gets +30 HP. |
| Golden Frame | Gift | +20 damage on Moves against Star Stickers. |
| Read Receipt | Gift | Draw a card when the wearer is damaged. |

## 12. Balance framework (how numbers are derived)

The generator (`scripts/generate_cards.py`) uses these rules so every card sits
on the same curve. Designers override individual cards afterwards in
`data/overrides.json`.

**HP by stage and tier** (base, before role adjustment):

| Stage | Tier L (rank 1–10) | Tier E (11–40) | Star (41–90) | Common (91–150) |
| --- | --- | --- | --- | --- |
| Static | 70 | 60–70 | 110–130 | 60–90 |
| Animated | 110–120 | 90–110 | — | — |
| Premium | 170–190 | — | — | — |

**Roles** (`class` in the roster) shift the profile:
Bruiser +20 HP −10 dmg; Striker −10 HP +10 dmg; Support +0, always has a Trait,
heal/draw Moves; Trickster −10 HP, status Moves, low Swap cost.

**Move damage curve** (base, before role/effect trade):

| Reaction cost | Static | Animated | Premium / Star |
| --- | --- | --- | --- |
| 1 | 10–20 | 20–30 | 30 |
| 2 | 20–30 | 40–50 | 60 |
| 3 | 40–50 | 70–80 | 90–110 |
| 4 | — | 100 | 130–150 |

**Effect pricing** (damage you "pay" for text on the same Move): status
−10 to −20, coin-flip upside ≈ free but expected value ≈ base, Chat snipe
20 = −20, self-damage +20, discard-a-Reaction +30, heal 30 = −20,
draw a card = −20.

**Weakness pressure check**: a Static must not one-shot a same-tier Static of
the type weak to it with a 1-cost Move. **Two-hit rule**: every Premium must
be KO-able in ≤3 Moves by a fully powered Animated of the type it's weak to.
The balance report flags violations.

**Swap cost** from final HP: ≤70 → 1, ≤110 → 2, ≤160 → 3, else 4; Trickster −1
(min 0), Bruiser +1 (max 4).

## 13. Term mapping (cheat sheet)

| Pokémon | Sticker League |
| --- | --- |
| Pokémon | Sticker |
| Basic / Stage 1 / Stage 2 | Static / Animated / Premium |
| Pokémon-ex | Star Sticker |
| Evolve | Upgrade |
| HP | HP (Hype Points) |
| Energy | Reaction |
| Colorless | Neutral (👀) |
| Attack | Move |
| Ability | Trait |
| Retreat / retreat cost | Swap / Swap cost |
| Active / Bench | Pinned / Chat |
| Deck / Discard / Prizes / Lost Zone | Feed / Archive / Stars / Deleted |
| Item / Supporter / Stadium / Tool | Bot / Admin / Channel / Gift |
| Poisoned / Burned / Asleep / Paralyzed / Confused | Spammed / Flamed / Muted / Lagging / Glitched |
| Knock Out | Knock Out (KO) |
