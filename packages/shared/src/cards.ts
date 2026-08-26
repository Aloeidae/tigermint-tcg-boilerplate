import type { CardDef } from './types.js';
import { DECK_SIZE } from './constants.js';
import { registerSummonEffect } from './effects.js';

/**
 * The demo card catalog. Used when no wallet is connected (or the collection
 * has too few NFTs to fill a deck). Replace or extend freely — every card is
 * just data plus, for spells, an effect key from effects.ts.
 */
export const DEMO_CATALOG: CardDef[] = [
  // --- Creatures (several carry skills from skills.ts as live examples) ---
  { id: 'demo-ember-pup', name: 'Ember Pup', type: 'creature', cost: 1, attack: 2, health: 1, art: 'art-ember', skills: [{ key: 'haste' }] },
  { id: 'demo-shield-sprout', name: 'Shield Sprout', type: 'creature', cost: 1, attack: 1, health: 3, art: 'art-sprout', skills: [{ key: 'guard' }] },
  { id: 'demo-river-scout', name: 'River Scout', type: 'creature', cost: 2, attack: 2, health: 3, art: 'art-scout', skills: [{ key: 'lifelink' }] },
  { id: 'demo-frost-archer', name: 'Frost Archer', type: 'creature', cost: 2, attack: 3, health: 2, art: 'art-archer', skills: [{ key: 'firstStrike' }] },
  { id: 'demo-cave-brute', name: 'Cave Brute', type: 'creature', cost: 3, attack: 4, health: 3, art: 'art-brute' },
  { id: 'demo-viper', name: 'Fen Viper', type: 'creature', cost: 3, attack: 1, health: 2, art: 'art-viper', skills: [{ key: 'deathtouch' }] },
  { id: 'demo-bog-asp', name: 'Bog Asp', type: 'creature', cost: 2, attack: 2, health: 2, art: 'art-asp', skills: [{ key: 'venomous', value: 1 }] },
  { id: 'demo-carrion-crow', name: 'Carrion Crow', type: 'creature', cost: 2, attack: 1, health: 2, art: 'art-crow', skills: [{ key: 'scavenger', value: 1 }] },
  { id: 'demo-herald', name: 'Meadow Herald', type: 'creature', cost: 3, attack: 2, health: 4, art: 'art-herald', skills: [{ key: 'inspiring', value: 1 }] },
  { id: 'demo-moss-golem', name: 'Moss Golem', type: 'creature', cost: 4, attack: 3, health: 6, art: 'art-golem', skills: [{ key: 'guard' }, { key: 'regenerate', value: 2 }] },
  { id: 'demo-storm-drake', name: 'Storm Drake', type: 'creature', cost: 5, attack: 5, health: 5, art: 'art-drake', skills: [{ key: 'haste' }] },
  { id: 'demo-colossus', name: 'Ancient Colossus', type: 'creature', cost: 6, attack: 7, health: 7, art: 'art-colossus', skills: [{ key: 'armor', value: 1 }] },

  // --- Equipment (skills on equipment are granted to the wearer) ---
  { id: 'demo-rusty-sword', name: 'Rusty Sword', type: 'equipment', cost: 1, attackBonus: 2, art: 'art-sword' },
  { id: 'demo-oak-shield', name: 'Oak Shield', type: 'equipment', cost: 1, healthBonus: 3, art: 'art-shield' },
  { id: 'demo-runed-blade', name: 'Runed Blade', type: 'equipment', cost: 3, attackBonus: 3, healthBonus: 1, art: 'art-blade' },
  { id: 'demo-charge-horn', name: 'Charge Horn', type: 'equipment', cost: 2, attackBonus: 1, art: 'art-horn', skills: [{ key: 'haste' }] },

  // --- Spells ---
  { id: 'demo-firebolt', name: 'Firebolt', type: 'spell', cost: 2, effect: { key: 'damage', amount: 3 }, art: 'art-firebolt' },
  { id: 'demo-healing-rain', name: 'Healing Rain', type: 'spell', cost: 2, effect: { key: 'heal', amount: 4 }, art: 'art-rain' },
  { id: 'demo-insight', name: 'Insight', type: 'spell', cost: 2, effect: { key: 'draw', amount: 2 }, art: 'art-insight' },
  { id: 'demo-battle-cry', name: 'Battle Cry', type: 'spell', cost: 1, effect: { key: 'buffAttack', amount: 2 }, art: 'art-cry' },
  { id: 'demo-meteor', name: 'Meteor', type: 'spell', cost: 4, effect: { key: 'aoeDamage', amount: 2 }, art: 'art-meteor' },
  { id: 'demo-venom-dart', name: 'Venom Dart', type: 'spell', cost: 1, effect: { key: 'poison', amount: 2 }, art: 'art-dart' },
  { id: 'demo-cold-snap', name: 'Cold Snap', type: 'spell', cost: 2, effect: { key: 'freeze', amount: 1 }, art: 'art-snap' },
  { id: 'demo-bark-ward', name: 'Bark Ward', type: 'spell', cost: 1, effect: { key: 'shield', amount: 3 }, art: 'art-ward' },
  { id: 'demo-acorn-call', name: 'Acorn Call', type: 'spell', cost: 2, effect: { key: 'summonSquirrel', amount: 2 }, art: 'art-acorn' },
];

/**
 * Token creatures — summoned by effects, never part of a deck. Register your
 * own with registerToken(); "Spell Effect: summon squirrel 2" (metadata or
 * pack.json) matches them by name.
 */
export const TOKENS = new Map<string, CardDef>();

export function registerToken(def: CardDef): void {
  TOKENS.set(def.id, def);
  registerSummonEffect(def);
}

/** Match a token by id or name ("squirrel" -> the Squirrel token), or null. */
export function findToken(name: string): CardDef | null {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const def of TOKENS.values()) {
    if (def.id.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return def;
    if (def.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return def;
  }
  return null;
}

registerToken({ id: 'token-squirrel', name: 'Squirrel', type: 'creature', cost: 0, attack: 1, health: 1, text: 'Token.', art: 'art-squirrel' });

/** Build a full-size demo deck by cycling through the catalog. */
export function buildDemoDeck(): CardDef[] {
  const deck: CardDef[] = [];
  for (let i = 0; deck.length < DECK_SIZE; i++) {
    deck.push(DEMO_CATALOG[i % DEMO_CATALOG.length]);
  }
  return deck;
}

/** Pad a (possibly short) deck up to DECK_SIZE with demo cards, then trim. */
export function padDeck(defs: CardDef[]): CardDef[] {
  const deck = defs.slice(0, DECK_SIZE);
  for (let i = 0; deck.length < DECK_SIZE; i++) {
    deck.push(DEMO_CATALOG[i % DEMO_CATALOG.length]);
  }
  return deck;
}
