import type { CardDef } from '../types.js';
import type { ReactionType } from './types.js';

/**
 * A built-in demo set for the pokemon game mode, so League presets play out
 * of the box with no pack or NFTs — same forest crew as the standard demo
 * catalog. Every card doubles as a worked example of the `game` block:
 * evolution lines, a star sticker, traits on three triggers, conditions,
 * flips, and one of each trainer kind.
 */

const energy = (id: string, type: ReactionType, emoji: string): CardDef => ({
  id: `pk-energy-${id}`,
  name: `${emoji} ${type} Reaction`,
  type: 'spell',
  cost: 0,
  text: 'Basic energy.',
  art: 'cardback',
  game: { kind: 'reaction', type, typeEmoji: emoji, special: false, provides: [type] },
});

export const POKEMON_DEMO_CARDS: CardDef[] = [
  // --- Solid line: Sprout Cub -> Bramble Bear ------------------------------
  {
    id: 'pk-cub', name: 'Sprout Cub', type: 'creature', cost: 2, attack: 2, health: 7,
    text: 'A stubborn little wall.', art: 'cardback', rarity: 'COMMON',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, type: 'Solid', typeEmoji: '👍', hp: 70,
      moves: [
        { name: 'Poke', cost: ['Neutral'], damage: 10, damageText: '10', expectedDamage: 10, text: '' },
        {
          name: 'Body Slam', cost: ['Solid', 'Solid'], damage: 30, damageText: '30', expectedDamage: 30,
          text: 'Flip a coin. If heads, the enemy Active is Lagging.',
          effects: [{ op: 'flipStatus', status: 'Lagging' }],
        },
      ],
      weakness: 'Mind', resistance: 'Chill', swapCost: 1,
    },
  },
  {
    id: 'pk-bear', name: 'Bramble Bear', type: 'creature', cost: 4, attack: 5, health: 12,
    text: 'The cub grew thorns.', art: 'cardback', rarity: 'RARE',
    game: {
      kind: 'sticker', stage: 'Animated', stageIndex: 1, upgradesFrom: 'pk-cub',
      type: 'Solid', typeEmoji: '👍', hp: 120,
      trait: {
        key: 'thick_fur', name: 'Thick Fur', trigger: 'static',
        text: 'Takes 10 less damage from moves.', effects: [{ op: 'armor', amount: 10 }],
      },
      moves: [
        { name: 'Maul', cost: ['Solid', 'Solid', 'Neutral'], damage: 60, damageText: '60', expectedDamage: 60, text: '' },
        {
          name: 'Reckless Crash', cost: ['Solid', 'Solid', 'Neutral', 'Neutral'], damage: 100, damageText: '100',
          expectedDamage: 100, text: 'This sticker does 20 damage to itself.',
          effects: [{ op: 'selfDamage', amount: 20 }],
        },
      ],
      weakness: 'Mind', resistance: 'Chill', swapCost: 3,
    },
  },
  // --- Blaze line: Ember Kit -> Cinder Fox ---------------------------------
  {
    id: 'pk-kit', name: 'Ember Kit', type: 'creature', cost: 1, attack: 2, health: 6,
    text: 'Warm to the touch. Sometimes too warm.', art: 'cardback', rarity: 'COMMON',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, type: 'Blaze', typeEmoji: '🔥', hp: 60,
      moves: [
        {
          name: 'Singe', cost: ['Blaze'], damage: 10, damageText: '10', expectedDamage: 10,
          text: 'Flip a coin. If heads, the enemy Active is Flamed.',
          effects: [{ op: 'flipStatus', status: 'Flamed' }],
        },
        { name: 'Tail Whip', cost: ['Neutral', 'Neutral'], damage: 20, damageText: '20', expectedDamage: 20, text: '' },
      ],
      weakness: 'Chill', resistance: 'Heart', swapCost: 1,
    },
  },
  {
    id: 'pk-fox', name: 'Cinder Fox', type: 'creature', cost: 3, attack: 5, health: 10,
    text: 'Leaves scorched pawprints.', art: 'cardback', rarity: 'RARE',
    game: {
      kind: 'sticker', stage: 'Animated', stageIndex: 1, upgradesFrom: 'pk-kit',
      type: 'Blaze', typeEmoji: '🔥', hp: 100,
      moves: [
        {
          name: 'Flame Burst', cost: ['Blaze', 'Neutral'], damage: 40, damageText: '40', expectedDamage: 40,
          text: 'The enemy Active is Flamed.', effects: [{ op: 'status', status: 'Flamed' }],
        },
        {
          name: 'Blaze Kick', cost: ['Blaze', 'Blaze', 'Neutral'], damage: 70, damageText: '70+', expectedDamage: 80,
          text: 'Flip a coin. If heads, this move does 20 more damage.',
          effects: [{ op: 'flipBonus', bonus: 20 }],
        },
      ],
      weakness: 'Chill', resistance: 'Heart', swapCost: 2,
    },
  },
  // --- Support cast --------------------------------------------------------
  {
    id: 'pk-asp', name: 'Bog Asp', type: 'creature', cost: 2, attack: 3, health: 5,
    text: 'Its bite festers.', art: 'cardback', rarity: 'COMMON',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, type: 'Gross', typeEmoji: '💩', hp: 60,
      moves: [
        {
          name: 'Venom Bite', cost: ['Gross'], damage: 10, damageText: '10', expectedDamage: 10,
          text: 'The enemy Active is Spammed.', effects: [{ op: 'status', status: 'Spammed' }],
        },
        { name: 'Gnaw', cost: ['Gross', 'Neutral'], damage: 30, damageText: '30', expectedDamage: 30, text: '' },
      ],
      weakness: 'Heart', resistance: 'Solid', swapCost: 1,
    },
  },
  {
    id: 'pk-herald', name: 'Meadow Herald', type: 'creature', cost: 2, attack: 2, health: 7,
    text: 'Sings the bruises away.', art: 'cardback', rarity: 'COMMON',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, type: 'Heart', typeEmoji: '❤️', hp: 70,
      trait: {
        key: 'self_care', name: 'Self-Care', trigger: 'onTurnStart',
        text: 'At the start of your turn, heal 20 damage from this sticker.',
        effects: [{ op: 'heal', amount: 20, target: 'self' }],
      },
      moves: [
        {
          name: 'Soothing Song', cost: ['Heart', 'Neutral'], damage: 20, damageText: '20', expectedDamage: 20,
          text: 'Heal 20 damage from each of your stickers.',
          effects: [{ op: 'heal', amount: 20, target: 'all' }],
        },
      ],
      weakness: 'Chaos', resistance: 'Mind', swapCost: 2,
    },
  },
  {
    id: 'pk-owl', name: 'Drowsy Owl', type: 'creature', cost: 2, attack: 2, health: 6,
    text: 'One hoot and the room yawns.', art: 'cardback', rarity: 'COMMON',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, type: 'Mind', typeEmoji: '🤯', hp: 60,
      moves: [
        {
          name: 'Hypno Hoot', cost: ['Mind', 'Neutral'], damage: 20, damageText: '20', expectedDamage: 20,
          text: 'Flip a coin. If heads, the enemy Active is Muted.',
          effects: [{ op: 'flipStatus', status: 'Muted' }],
        },
      ],
      weakness: 'Gross', resistance: 'Zap', swapCost: 1,
    },
  },
  {
    id: 'pk-grizzly', name: 'Grandfather Grizzly', type: 'creature', cost: 5, attack: 6, health: 13,
    text: 'The forest answers to him.', art: 'cardback', rarity: 'LEGENDARY',
    game: {
      kind: 'sticker', stage: 'Static', stageIndex: 0, star: true, type: 'Solid', typeEmoji: '👍', hp: 130,
      starsOnKO: 2,
      moves: [
        {
          name: 'Long Nap', cost: ['Neutral'], damage: 0, damageText: '', expectedDamage: 15,
          text: 'Heal 40 damage from this sticker.',
          effects: [{ op: 'heal', amount: 40, target: 'self' }],
        },
        {
          name: 'Heavy Swipe', cost: ['Solid', 'Solid', 'Neutral'], damage: 80, damageText: '80', expectedDamage: 80,
          text: 'This sticker does 20 damage to itself.',
          effects: [{ op: 'selfDamage', amount: 20 }],
        },
      ],
      weakness: 'Mind', resistance: null, swapCost: 3,
    },
  },
  // --- Trainers: one of each kind ------------------------------------------
  {
    id: 'pk-bot-forage', name: 'Forage', type: 'spell', cost: 1, text: 'Search your deck for a sticker.',
    art: 'cardback', rarity: 'COMMON',
    game: { kind: 'bot', text: 'Search your deck for a sticker, reveal it, and put it into your hand.', effects: [{ op: 'search', filter: { kind: 'sticker' }, count: 1 }] },
  },
  {
    id: 'pk-bot-scout', name: 'Scout Ahead', type: 'spell', cost: 1, text: 'Draw 2 cards.',
    art: 'cardback', rarity: 'COMMON',
    game: { kind: 'bot', text: 'Draw 2 cards.', effects: [{ op: 'draw', count: 2 }] },
  },
  {
    id: 'pk-admin-den', name: 'Den Mother', type: 'spell', cost: 2, text: 'Draw 3 cards.',
    art: 'cardback', rarity: 'RARE',
    game: { kind: 'admin', text: 'Draw 3 cards.', effects: [{ op: 'draw', count: 3 }] },
  },
  {
    id: 'pk-gift-acorn', name: 'Acorn Charm', type: 'equipment', cost: 1, text: '+30 HP.',
    art: 'cardback', rarity: 'COMMON',
    game: { kind: 'gift', text: 'The sticker this is attached to gets +30 HP.', effects: [{ op: 'hpBonus', amount: 30 }] },
  },
  {
    id: 'pk-channel-grove', name: 'Sunlit Grove', type: 'spell', cost: 2,
    text: 'Draw when your Active is a basic.', art: 'cardback', rarity: 'RARE',
    game: {
      kind: 'channel',
      text: 'Once during each player’s turn, that player draws a card if their Active sticker is a basic.',
      effects: [{ op: 'conditionalDraw', condition: { activeStage: 0 }, side: 'both' }],
    },
  },
  // --- Basic energy --------------------------------------------------------
  energy('solid', 'Solid', '👍'),
  energy('blaze', 'Blaze', '🔥'),
  energy('gross', 'Gross', '💩'),
  energy('heart', 'Heart', '❤️'),
  energy('mind', 'Mind', '🤯'),
];
