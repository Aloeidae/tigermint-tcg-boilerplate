# Snugglefang Woods — card generation prompts

A cute-animal **demo pack** for Tigermint TCG — a worked example of the full
pipeline from prompts to playable, mintable cards. It is not a standard:
swap the theme, names, stats, and skills for your own game. 18 unique cards
(9 creatures, 4 equipment, 5 spells) that mirror the built-in demo catalog's
cost curve, so the pack is fair against it out of the box.

## How to use

1. In your image generator, attach **docs/ref-card.jpeg** (the Ember Pup card) to every
   generation — it is the layout and style template.
2. Paste one prompt below per generation. Each prompt is self-contained.
3. Ask for **portrait, 3:4 aspect ratio** — the in-game cards are 3:4, so 3:4
   art fits pixel-perfect (other ratios are center-cropped, never stretched).
4. Test before minting: copy `packages/client/public/pack/pack.example.json`
   to `pack.json` in the same folder and drop your images next to it with the
   listed filenames — the game picks the pack up automatically as your deck
   when no wallet is connected. Check the four corner panels stay clear of the
   game's cost/attack/health/equipment badges.
5. Mint each card with the metadata listed under its prompt — the art is
   decorative; metadata is what the engine reads. `Card Style: full art` on
   every card.

The four empty rounded corner panels are **reserved**: the game overlays cost
(top-left), attack (bottom-left), health (bottom-right) and an equipment chip
(top-right) there at runtime. No prompt below touches them.

---

## Creatures

### 1 · Cinder Kit — 1 mana 2/1, Haste

```
Use the attached card image as an exact template. Keep the entire layout identical: the parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab under it, and the scroll text box all stay in exactly the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY these four things: (1) inside the circular medallion, replace the illustration with a tiny fox kit with ember-orange fur and a small flame-tipped tail, mid-pounce in fresh snow, same cute thick-outline watercolor style; (2) the name plate reads "CINDER KIT"; (3) the small tab reads "⚡ Haste"; (4) the italic line in the scroll box reads "Too excited to wait for anything." Leave the four corner panels empty. All text horizontal and spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 1 · Attack: 2 · Health: 1 · Skills: Haste · Card Style: full art`

### 2 · Hedgeling — 1 mana 1/3, Guard

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box all stay in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a round sleepy hedgehog curled into a spiky ball on a mossy stump with snowflakes settling on its quills, same cute thick-outline watercolor style; (2) the name plate reads "HEDGELING"; (3) the small tab reads "🛡 Guard"; (4) the scroll box line reads "Small. Round. Completely in your way." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 1 · Attack: 1 · Health: 3 · Skills: Guard · Card Style: full art`

### 3 · River Otter Medic — 2 mana 2/3, Lifelink

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a cheerful otter floating on its back in an icy stream, hugging a softly glowing healing herb to its chest, same cute thick-outline watercolor style; (2) the name plate reads "RIVER OTTER MEDIC"; (3) the small tab reads "♥ Lifelink"; (4) the scroll box line reads "Every splash mends a scratch." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 2 · Attack: 2 · Health: 3 · Skills: Lifelink · Card Style: full art`

### 4 · Snowshoe Archer — 2 mana 3/2, First Strike

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a fluffy white snowshoe hare in a tiny leaf-green hood drawing a twig bow, ears alert, snowy pines behind, same cute thick-outline watercolor style; (2) the name plate reads "SNOWSHOE ARCHER"; (3) the small tab reads "⚔ First Strike"; (4) the scroll box line reads "Loosed before you blinked." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 2 · Attack: 3 · Health: 2 · Skills: First Strike · Card Style: full art`

### 5 · Badger Bruiser — 3 mana 4/3, no skill

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a stocky badger cracking its knuckles with one eyebrow raised, standing in a snowy clearing, same cute thick-outline watercolor style; (2) the name plate reads "BADGER BRUISER"; (3) REMOVE the small skill tab under the name plate entirely — the scroll text box extends slightly upward to fill that space; (4) the scroll box line reads "Doesn't do tricks. Does damage." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 3 · Attack: 4 · Health: 3 · Card Style: full art`

### 6 · Garden Adder — 3 mana 1/2, Deathtouch

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a small emerald snake with big innocent eyes coiled around a frost-dusted red mushroom, tongue sticking out, same cute thick-outline watercolor style; (2) the name plate reads "GARDEN ADDER"; (3) the small tab reads "☠ Deathtouch"; (4) the scroll box line reads "One friendly little nibble." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 3 · Attack: 1 · Health: 2 · Skills: Deathtouch · Card Style: full art`

### 7 · Moss Tortoise — 4 mana 3/6, Guard + Regenerate 2

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes an ancient smiling tortoise with a tiny garden of moss, miniature pines, and glowing flowers growing on its shell, same cute thick-outline watercolor style; (2) the name plate reads "MOSS TORTOISE"; (3) the small tab reads "🛡 Guard · ♻ Regenerate 2"; (4) the scroll box line reads "The forest walks with him." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 4 · Attack: 3 · Health: 6 · Skills: Guard, Regenerate 2 · Card Style: full art`

### 8 · Gale Falcon — 5 mana 5/5, Haste

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes a sleek falcon diving through storm clouds, trailing streaks of wind and snow behind its swept-back wings, same cute thick-outline watercolor style; (2) the name plate reads "GALE FALCON"; (3) the small tab reads "⚡ Haste"; (4) the scroll box line reads "The sky arrives first." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 5 · Attack: 5 · Health: 5 · Skills: Haste · Card Style: full art`

### 9 · Grandfather Grizzly — 6 mana 7/7, Armor 1

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the teal-and-gold circular art medallion, the name plate, the small skill tab, and the scroll text box in the same positions, sizes, colors, and hand-drawn storybook style. Change ONLY: (1) the medallion illustration becomes an enormous grey-muzzled grizzly bear wearing a knitted scarf, sitting calm as a mountain with two small birds perched on his shoulders, same cute thick-outline watercolor style; (2) the name plate reads "GRANDFATHER GRIZZLY"; (3) the small tab reads "⛨ Armor 1"; (4) the scroll box line reads "He has outlasted worse winters than you." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: creature · Cost: 6 · Attack: 7 · Health: 7 · Skills: Armor 1 · Card Style: full art`

---

## Equipment

Equipment cards recolor the medallion ring and plate accents from teal to
**warm bronze** so the type reads at a glance.

### 10 · Twig Sword — 1 mana, +2/+0

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, the small tab, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to warm bronze. Change: (1) the medallion illustration becomes a proudly whittled twig shaped like a little sword, resting on an acorn-cap stand, same cute thick-outline watercolor style; (2) the name plate reads "TWIG SWORD"; (3) the small tab reads "+2 / +0"; (4) the scroll box has an upright line "Attach to a friendly creature." and an italic line "Sharp enough, if you believe." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: equipment · Cost: 1 · Attack: 2 · Health: 0 · Card Style: full art`

### 11 · Walnut Buckler — 1 mana, +0/+3

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, the small tab, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to warm bronze. Change: (1) the medallion illustration becomes a polished half walnut shell strapped with tiny vines like a shield, leaning against a pebble, same cute thick-outline watercolor style; (2) the name plate reads "WALNUT BUCKLER"; (3) the small tab reads "+0 / +3"; (4) the scroll box has an upright line "Attach to a friendly creature." and an italic line "Locally grown protection." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: equipment · Cost: 1 · Attack: 0 · Health: 3 · Card Style: full art`

### 12 · Honeyed Claws — 3 mana, +3/+1

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, the small tab, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to warm bronze. Change: (1) the medallion illustration becomes a set of gleaming claw caps dripping with golden honey while friendly bees circle admiringly, same cute thick-outline watercolor style; (2) the name plate reads "HONEYED CLAWS"; (3) the small tab reads "+3 / +1"; (4) the scroll box has an upright line "Attach to a friendly creature." and an italic line "Sweet and extremely pointy." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: equipment · Cost: 3 · Attack: 3 · Health: 1 · Card Style: full art`

### 13 · Zoomie Whistle — 2 mana, +1/+0, grants Haste

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, the small tab, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to warm bronze. Change: (1) the medallion illustration becomes a tiny acorn whistle on a red string with cartoon motion lines and scattered paw prints all around it, same cute thick-outline watercolor style; (2) the name plate reads "ZOOMIE WHISTLE"; (3) the small tab reads "+1 / +0 · ⚡ Haste"; (4) the scroll box has an upright line "Attach to a friendly creature." and an italic line "Activates the zoomies. Immediately." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: equipment · Cost: 2 · Attack: 1 · Health: 0 · Skills: Haste · Card Style: full art`

---

## Spells

Spell cards recolor the medallion ring and plate accents to **soft violet**,
drop the skill tab, and put the rules text (upright) plus flavor (italic) in
the scroll box.

### 14 · Angry Bee Swarm — 2 mana, deal 3 damage

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to soft violet, and REMOVE the small tab under the name plate (the scroll box extends slightly upward). Change: (1) the medallion illustration becomes a furious little cloud of cartoon bees forming an arrow shape, the lead bee wearing a tiny helmet, same cute thick-outline watercolor style; (2) the name plate reads "ANGRY BEE SWARM"; (3) the scroll box has an upright line "Deal 3 damage to any target." and an italic line "They remember what you did." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: spell · Cost: 2 · Spell Effect: damage 3 · Card Style: full art`

### 15 · Cozy Nap — 2 mana, restore 4 health

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to soft violet, and REMOVE the small tab under the name plate (the scroll box extends slightly upward). Change: (1) the medallion illustration becomes a pile of assorted woodland animals fast asleep in one big knitted blanket nest with a single snore bubble, same cute thick-outline watercolor style; (2) the name plate reads "COZY NAP"; (3) the scroll box has an upright line "Restore 4 health to a friendly creature or yourself." and an italic line "Do not disturb." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: spell · Cost: 2 · Spell Effect: heal 4 · Card Style: full art`

### 16 · Snack Time — 2 mana, draw 2

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to soft violet, and REMOVE the small tab under the name plate (the scroll box extends slightly upward). Change: (1) the medallion illustration becomes a chipmunk with heroically overstuffed cheeks standing over an open picnic basket of berries and acorns, same cute thick-outline watercolor style; (2) the name plate reads "SNACK TIME"; (3) the scroll box has an upright line "Draw 2 cards." and an italic line "Thinking food." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: spell · Cost: 2 · Spell Effect: draw 2 · Card Style: full art`

### 17 · Battle Squeak — 1 mana, +2 attack

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to soft violet, and REMOVE the small tab under the name plate (the scroll box extends slightly upward). Change: (1) the medallion illustration becomes a tiny mouse on a pebble podium mid-squeak, visible sound waves rippling outward while other small animals look on inspired, same cute thick-outline watercolor style; (2) the name plate reads "BATTLE SQUEAK"; (3) the scroll box has an upright line "Give a friendly creature +2 attack." and an italic line "The squeak heard round the woods." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: spell · Cost: 1 · Spell Effect: buffAttack 2 · Card Style: full art`

### 18 · Skunk Bomb — 4 mana, 2 damage to all enemies

```
Use the attached card image as an exact template. Keep the entire layout identical: parchment background, decorative border, the four empty rounded corner panels, the circular art medallion, the name plate, and the scroll text box in the same positions, sizes, and hand-drawn storybook style — but recolor the medallion ring and the name plate accents from teal to soft violet, and REMOVE the small tab under the name plate (the scroll box extends slightly upward). Change: (1) the medallion illustration becomes a smug skunk doing a handstand while a dramatic pale-green cloud billows across the scene and tiny animals flee at the edges, same cute thick-outline watercolor style; (2) the name plate reads "SKUNK BOMB"; (3) the scroll box has an upright line "Deal 2 damage to all enemy creatures." and an italic line "You'll smell it before you see it." Leave the four corner panels empty. All text horizontal, spelled exactly as written. Portrait, 3:4.
```

Mint: `Type: spell · Cost: 4 · Spell Effect: aoeDamage 2 · Card Style: full art`

---

## Mint metadata summary

| # | Card | Type | Cost | Atk | HP | Skills / Effect |
|---|---|---|---|---|---|---|
| 1 | Cinder Kit | creature | 1 | 2 | 1 | Haste |
| 2 | Hedgeling | creature | 1 | 1 | 3 | Guard |
| 3 | River Otter Medic | creature | 2 | 2 | 3 | Lifelink |
| 4 | Snowshoe Archer | creature | 2 | 3 | 2 | First Strike |
| 5 | Badger Bruiser | creature | 3 | 4 | 3 | — |
| 6 | Garden Adder | creature | 3 | 1 | 2 | Deathtouch |
| 7 | Moss Tortoise | creature | 4 | 3 | 6 | Guard, Regenerate 2 |
| 8 | Gale Falcon | creature | 5 | 5 | 5 | Haste |
| 9 | Grandfather Grizzly | creature | 6 | 7 | 7 | Armor 1 |
| 10 | Twig Sword | equipment | 1 | +2 | +0 | — |
| 11 | Walnut Buckler | equipment | 1 | +0 | +3 | — |
| 12 | Honeyed Claws | equipment | 3 | +3 | +1 | — |
| 13 | Zoomie Whistle | equipment | 2 | +1 | +0 | Haste |
| 14 | Angry Bee Swarm | spell | 2 | — | — | Spell Effect: damage 3 |
| 15 | Cozy Nap | spell | 2 | — | — | Spell Effect: heal 4 |
| 16 | Snack Time | spell | 2 | — | — | Spell Effect: draw 2 |
| 17 | Battle Squeak | spell | 1 | — | — | Spell Effect: buffAttack 2 |
| 18 | Skunk Bomb | spell | 4 | — | — | Spell Effect: aoeDamage 2 |

Every card gets `Card Style: full art`, and spells get a `Spell Effect`
attribute (e.g. `damage 3`, `aoe damage 2`) — the mapper matches it against
the effect registry so the painted rules text always matches the real effect.

## From images to playable cards

**Before minting (local pack):** the images and this metadata already work
without any blockchain step. `packages/client/public/pack/pack.example.json`
contains this whole set — copy it to `pack.json`, drop your generated images
into that folder with the listed filenames, and the game uses the pack as your
deck whenever no wallet is connected.

**When minting:** filenames stop mattering entirely. Each minted NFT carries
its own metadata JSON (`name`, `image` URL, `attributes`); the minting flow
binds each uploaded image to its attribute row, and the game reads that
metadata — never the filename.

Mint on **TigerMint** (https://mint.tendytiger.lol) — the blind-mint launchpad
turns this set into a proper booster-pack experience: players pull a card,
reveal it, and battle with it. Two ways in, both working from the exact
`pack.json` you playtested:

1. **`npm run mint-pack`** — preflights the pack (manifest, images, aspect
   ratios, rarities) and opens the Pro Wizard for you.
2. **The [Pro Wizard](https://mint.tendytiger.lol/project/submit)** does the
   minting itself — pick the trait-based collection type, choose "Import
   rendered art", drop the 18 images plus `pack.json` (accepted natively as
   the manifest), then add your cover, banner, description, socials, and
   phases before signing the deploy. CSV works too; per-item names mint
   through as-is.

Give each card an explicit `rarity` (`LEGENDARY/EPIC/RARE/COMMON`) in the
manifest — that pins its pull-weight tier; the shipped example already has a
spread (Grandfather Grizzly LEGENDARY, three EPICs, five RAREs).

Once live, set `VITE_NFT_COLLECTION` to the new collection address and every
holder's wallet becomes their Snugglefang deck. Add `VITE_TIGERMINT_SLUG` +
`VITE_TIGERMINT_API_KEY` and players can blind-pull new cards from the game's
menu itself.
