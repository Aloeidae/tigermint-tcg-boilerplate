# Game Mechanics Reference

Everything the engine does, in one place — for designing cards and building
balanced decks. Numbers below are the **Classic Duel** defaults; the
[rules presets](#9-rules-presets--knobs) section lists every knob that
changes them.

---

## 1. Core numbers

| Constant | Default |
| --- | --- |
| Starting life | 20 |
| Deck size | 30 cards |
| Opening hand | 5 (first player skips the turn-1 draw) |
| Hand cap | 10 — drawing past it **burns** the card to the graveyard |
| Board row | 6 creature slots per player |
| Mana cap | 10 |
| Attacks per creature per turn | 1 |

**Winning:** reduce the opponent to 0 life. If both players hit 0 at once,
the active player (whoever caused it) wins. Drawing from an empty deck loses
instantly under default fatigue rules.

## 2. Turn structure

```
Turn start ─► Main 1 ─► Combat ─► Main 2 ─► End turn
```

- **Turn start:** +1 max mana (to cap), mana refills, creatures ready,
  draw a card, then turn-start skills fire (Regenerate), then statuses tick
  (Poison damage, Frozen counts down).
- **Main phases:** play any cards you can afford — creatures, equipment,
  spells. Two main phases means you can summon *after* combat too.
- **Combat:** each ready creature may attack once — an enemy creature or the
  enemy face.
- **End turn:** end-of-turn skills fire (Inspiring), then the opponent's
  turn starts.

**Mulligan** (presets with `mulligan: true`): during the first round, each
player may once shuffle back their opening hand and redraw the same number
of cards, free, even while it isn't their turn.

## 3. Mana

Hearthstone-style: max mana starts at 1, grows +1 per turn to the cap, and
refills fully every turn. There are no lands and no floating mana — deck
curves matter enormously (see [balance notes](#11-balance-notes)).

## 4. Combat resolution

There are two combat systems (`combatStyle` in the rules):

### Blockers combat (Classic Duel — MTG-style)

Attackers never choose targets. The flow:

1. **Declare attackers** (combat phase): tap ready creatures to toggle them
   into the attack — all attacks aim at the enemy player. Confirm with
   **Attack ×N**.
2. **Block step**: the DEFENDER assigns blockers — any of their creatures,
   one blocker per attacker, one attacker per blocker. This is the only
   moment the non-active player acts.
3. **Resolution**: each blocked attacker fights its blocker (First Strike
   honored; a blocker always strikes back). Each **unblocked** attacker
   hits the face. You cannot reach the player while they have creatures
   willing to block — but they choose what to spend.

If the defender has no creatures at all, the attack resolves straight to
the face with no block step.

### Targeted combat (Guarded Arena, Blitz, Attrition)

The attacker picks each attack's target — an enemy creature (a damage
exchange) or the face:

1. If exactly one side has **First Strike**, it deals its damage first; a
   defender killed this way never strikes back.
2. Otherwise damage is simultaneous. Defenders strike back only when the
   rules have `retaliation: true` (default yes) and their attack is > 0.

The **face** is off-limits while any enemy creature has **Guard** (kill
guards first — they also protect non-guard allies from being attacked), or
whenever the preset sets `mustAttackCreaturesFirst`.

### Both modes

**Spells ignore Guard and blockers entirely** — combat restrictions never
constrain spell targeting. A creature cannot attack the turn it is summoned
(summoning sickness) unless it has Haste or the preset disables sickness.
**Frozen** creatures cannot attack (they may still block).

## 5. The damage pipeline

Every point of damage — combat AND spells — flows through one pipeline, in
this order:

```
base damage
  ─► attacker's modifyDamageDealt skills
  ─► attacker's damage-dealt statuses
  ─► defender's modifyDamageTaken skills   (Armor subtracts here)
  ─► defender's damage-taken statuses      (Shield absorbs here, last)
  ─► health lost
  ─► attacker's afterDealDamage skills     (Lifelink / Deathtouch / Venomous)
```

Consequences worth designing around:

- **Armor beats spells too** — Armor 2 shrugs off a Firebolt down to 1.
- **Armor and Shield both reduce Poison ticks** (poison damage runs through
  the pipeline with no source).
- `afterDealDamage` triggers only if damage **actually got through** — fully
  absorbing a Deathtouch or Venomous hit with Shield/Armor negates the
  rider entirely.
- Deathtouch destroys regardless of the defender's remaining health, but
  only when ≥1 damage lands.

**Death:** at 0 health a creature's `onDeath` hooks fire (they may save it
by healing above 0); if it still dies, it and its equipment go to the
graveyard and every surviving ally's `onAllyDeath` hooks fire (Scavenger).

## 6. Card types

| Type | Fields | Behavior |
| --- | --- | --- |
| **Creature** | cost, attack, health, skills | Summons to a row slot; fights; carries statuses and equipment. |
| **Equipment** | cost, +attack/+health, skills, optional on-attach effect | Attaches to a friendly creature; bonuses and skills last while attached; dies with the wearer. |
| **Spell** | cost, effect + amount | One-shot effect from the registry, then to the graveyard. |

## 7. Skills (keyword abilities)

Skills live on creatures, or on equipment (granted to the wearer while
attached). `value` is the number after the name (`Armor 2`).

| Skill | Icon | Timing | Effect |
| --- | --- | --- | --- |
| **Haste** | ⚡ | on summon | Can attack the turn it enters play (ignores summoning sickness). |
| **Guard** | 🛡 | passive | Enemies must attack this creature before any other target — protects the face AND its non-guard allies. |
| **First Strike** | ⚔ | combat | Deals combat damage first; a defender it kills never strikes back. No effect when both sides have it. |
| **Armor _v_** | ⛨ | incoming damage | Takes _v_ less damage from **all** sources (combat, spells, poison). |
| **Lifelink** | ♥ | after dealing damage | Its owner heals for the damage it actually deals (combat and face hits). |
| **Deathtouch** | ☠ | after dealing damage | Any creature it damages (≥1 through) is destroyed outright. |
| **Regenerate _v_** | ♻ | own turn start | Heals itself _v_ (up to max health). |
| **Venomous _v_** | 🐍 | after dealing damage | Poisons the creature it damaged for _v_ (see statuses). |
| **Scavenger _v_** | 🦴 | ally dies | Gains +_v_/+_v_ permanently whenever a friendly creature dies. |
| **Inspiring _v_** | 🎺 | own turn end | Heals its owner _v_ life. |

On cards/NFT metadata: `Skills: "Haste, Armor 2"` — matched by name against
the registry, renames via `configureSkill()` included.

## 8. Statuses (counters on creatures)

Applied by spells, or by skills (Venomous). Re-applying **adds values**
(Poison 2 + Poison 1 = Poison 3) and keeps the longer duration. Statuses
show as icon chips on the board card and vanish when the creature dies.

| Status | Icon | Effect | Ends |
| --- | --- | --- | --- |
| **Poison _v_** | ☠ | Takes _v_ damage at the start of its owner's every turn (reduced by Armor/Shield). | Never — until the creature dies. |
| **Frozen** | ❄ | Cannot attack. | Blocks exactly one full turn of its owner's, then thaws at their next turn start. |
| **Shield _v_** | 🛡 | Absorbs the next _v_ total damage from any source, applied after Armor. | When fully spent. |

## 9. Spell / equipment effects

The `effect` on a spell (or an on-attach equipment effect). `amount` is the
number; metadata form is `Spell Effect: "damage 3"`.

| Effect key | Target | Does |
| --- | --- | --- |
| `damage` | any creature or face | Deal _amount_ damage (through the pipeline — Armor/Shield apply). |
| `aoeDamage` | none | Deal _amount_ to **all enemy creatures**. |
| `heal` | friendly creature or own face | Restore _amount_ health (creatures capped at max health). |
| `draw` | none | Draw _amount_ cards (fatigue/burn rules apply). |
| `buffAttack` | friendly creature | +_amount_ attack, permanent. |
| `poison` | enemy creature | Apply Poison _amount_. |
| `freeze` | enemy creature | Apply Frozen (one full turn). |
| `shield` | friendly creature | Apply Shield _amount_. |
| `summonSquirrel` | none | Summon _amount_ Squirrel tokens (1/1) into free slots — extras beyond the row are lost. Any `registerToken()` adds a matching `summon<Name>` effect. |

Tokens obey summoning sickness, count toward the 6-slot row, and disappear
to the graveyard like normal creatures (they were never in the deck).

## 10. Rules presets & knobs

| Preset | Life | Twist |
| --- | --- | --- |
| **Classic Duel** | 20 | MTG-style blockers combat. Free mulligan. Empty-deck draw = loss. |
| **Guarded Arena** | 30 | Every creature guards the face; fatigue deals growing damage instead of losing. |
| **Blitz** | 15 | No summoning sickness (everything has Haste); 4-card opening hand. |
| **Attrition** | 40 | Long game: growing fatigue damage, free mulligan. |

Every knob (all in `shared/src/rules.ts`, all changeable per preset):
`startingLife`, `deckSize`, `openingHand`, `maxHand`, `maxRow`, `manaCap`,
`firstPlayerDraws`, `summoningSickness`, `attacksPerTurn`,
`mustAttackCreaturesFirst`, `retaliation`, `fatigue` (`lose`/`damage`),
`mulligan`, `combatStyle` (`targeted`/`blockers`).

Balance note for blockers decks: Guard does nothing under blockers combat
(all attacks already aim at the player), while board width, First Strike,
and Deathtouch get much stronger — a Deathtouch blocker trades up into
anything it blocks.

## 11. Deck construction

- Decks are **30 cards**, assembled from two pools:
  - **Basic deck** — free for everyone: cards with rarity COMMON or none
    (a per-card `basic: true/false` in pack.json overrides). Up to **3
    copies** each in the deck builder.
  - **Minted cards** — RARE / EPIC / LEGENDARY play only as owned NFTs, one
    copy per token held (pull the same card twice = two copies).
- Unpicked slots auto-fill from the basic deck, so partial decks are always
  legal.

## 12. Balance notes

**Vanilla stat budget** (what the NFT mapper gives cards with no metadata,
and a good baseline for judging your designs):

- **Creature:** attack + health ≈ `2 × cost + 1`. A 3-cost vanilla is a 4/3
  or 3/4.
- **Equipment:** +attack + +health ≈ `cost + 1`.
- **Spells:** `damage` ≈ cost + 1; `heal` ≈ cost + 2; AoE trades ~2 total
  cost for hitting everything.

**Pricing keywords** — treat a skill as spending part of the stat budget.
Rough guide from the demo set: Haste, Guard, First Strike, Lifelink ≈ 1
stat point; Armor 1, Deathtouch, Regenerate 2 ≈ 2 points (Deathtouch is
worth more on low-attack bodies, Armor more on high-health ones); Venomous,
Scavenger, Inspiring ≈ 1–2 depending on the value.

**Curve:** mana refills every turn, so the deck that spends all its mana
every turn usually wins. A solid 30-card spread: ~8 cards at 1–2 cost,
~10 at 3–4, ~6 at 5+, ~6 spells/equipment across the curve. The builder's
stats strip shows your curve live.

**Interaction checklist for a healthy meta:** every deck wants an answer to
a Guard wall (AoE, Deathtouch, Poison), to a buffed carry (Freeze, hard
damage), and to burn (healing, Shield, Lifelink). If one deck can't be
answered by the others' tools, re-price it.

**The AI opponent** (for vs-AI balance testing): plays its most expensive
affordable creature, equips its strongest body, targets spells greedily,
and attacks to kill creatures it can kill — otherwise goes face. It doesn't
hold combos, so decks that need setup turns will overperform against humans
relative to the AI.

## 13. Demo catalog reference

The built-in set (fills basic decks when no pack.json exists) — also a
tuning yardstick:

| Card | Cost | Type | Stats | Skills / Effect |
| --- | --- | --- | --- | --- |
| Ember Pup | 1 | creature | 2/1 | Haste |
| Shield Sprout | 1 | creature | 1/3 | Guard |
| River Scout | 2 | creature | 2/3 | Lifelink |
| Frost Archer | 2 | creature | 3/2 | First Strike |
| Bog Asp | 2 | creature | 2/2 | Venomous 1 |
| Carrion Crow | 2 | creature | 1/2 | Scavenger 1 |
| Cave Brute | 3 | creature | 4/3 | — |
| Fen Viper | 3 | creature | 1/2 | Deathtouch |
| Meadow Herald | 3 | creature | 2/4 | Inspiring 1 |
| Moss Golem | 4 | creature | 3/6 | Guard, Regenerate 2 |
| Storm Drake | 5 | creature | 5/5 | Haste |
| Ancient Colossus | 6 | creature | 7/7 | Armor 1 |
| Rusty Sword | 1 | equipment | +2/+0 | — |
| Oak Shield | 1 | equipment | +0/+3 | — |
| Charge Horn | 2 | equipment | +1/+0 | grants Haste |
| Runed Blade | 3 | equipment | +3/+1 | — |
| Firebolt | 2 | spell | — | damage 3 |
| Healing Rain | 2 | spell | — | heal 4 |
| Insight | 2 | spell | — | draw 2 |
| Battle Cry | 1 | spell | — | buffAttack 2 |
| Venom Dart | 1 | spell | — | poison 2 |
| Cold Snap | 2 | spell | — | freeze |
| Bark Ward | 1 | spell | — | shield 3 |
| Meteor | 4 | spell | — | aoeDamage 2 |
| Acorn Call | 2 | spell | — | summon 2 Squirrels (1/1) |
| *Squirrel* | 0 | token | 1/1 | (summon only, never in decks) |

## 14. Snugglefang Woods reference

The example pack (`pack.example.json`) with its rarity gates — COMMON =
basic deck, RARE+ = mint-only unless flagged `basic`:

| Card | Cost | Type | Stats | Skills / Effect | Rarity |
| --- | --- | --- | --- | --- | --- |
| Cinder Kit | 1 | creature | 2/1 | Haste | COMMON |
| Hedgeling | 1 | creature | 1/3 | Guard | COMMON |
| River Otter Medic | 2 | creature | 2/3 | Lifelink | COMMON |
| Snowshoe Archer | 2 | creature | 3/2 | First Strike | RARE (kept `basic`) |
| Badger Bruiser | 3 | creature | 4/3 | — | RARE |
| Garden Adder | 3 | creature | 1/2 | Deathtouch | RARE |
| Moss Tortoise | 4 | creature | 3/6 | Guard, Regenerate 2 | EPIC |
| Gale Falcon | 5 | creature | 5/5 | Haste | EPIC |
| Grandfather Grizzly | 6 | creature | 7/7 | Armor 1 | LEGENDARY |
| Twig Sword | 1 | equipment | +2/+0 | — | COMMON |
| Walnut Buckler | 1 | equipment | +0/+3 | — | COMMON |
| Zoomie Whistle | 2 | equipment | +1/+0 | grants Haste | COMMON |
| Honeyed Claws | 3 | equipment | +3/+1 | — | RARE |
| Angry Bee Swarm | 2 | spell | — | damage 3 | RARE |
| Cozy Nap | 2 | spell | — | heal 4 | COMMON |
| Snack Time | 2 | spell | — | draw 2 | COMMON |
| Battle Squeak | 1 | spell | — | buffAttack 2 | COMMON |
| Skunk Bomb | 4 | spell | — | aoeDamage 2 | EPIC |
