import type { CardDef } from '../types.js';

/**
 * A self-contained jungle warband for the rows mode — enough spies, bonds,
 * musters, weather and horns to show every mechanic. Cost is unused (no
 * mana); type rides 'creature'/'spell' so shared UI keeps working.
 */

const unit = (id: string, name: string, power: number, row: 'melee' | 'ranged' | 'siege' | 'agile', extra?: Partial<NonNullable<CardDef['rows']>>, text?: string): CardDef => ({
  id, name, type: 'creature', cost: 0, text,
  rows: { kind: 'unit', row, power, ...extra },
});

const special = (id: string, name: string, kind: NonNullable<NonNullable<CardDef['rows']>['special']>, text: string): CardDef => ({
  id, name, type: 'spell', cost: 0, text,
  rows: { kind: 'special', special: kind },
});

export const ROWS_DEMO_CARDS: CardDef[] = [
  unit('alpha-tiger', 'Alpha Tiger', 10, 'melee', { hero: true }, 'Hero: ignores weather, horns and scorch.'),
  unit('elder-ape', 'Elder Ape', 9, 'siege', { hero: true }, 'Hero: ignores weather, horns and scorch.'),
  unit('striped-brawler', 'Striped Brawler', 6, 'melee'),
  unit('raider-pack', 'Raider Pack', 4, 'melee', { ability: 'muster', musterTag: 'raiders' }, 'Muster: pulls every Raider Pack from your deck into play.'),
  unit('cub-twins', 'Cub Twins', 4, 'melee', { ability: 'bond' }, 'Bond: copies in the same row multiply each other.'),
  unit('vine-spy', 'Vine Spy', 7, 'melee', { ability: 'spy' }, 'Spy: joins the enemy row (their points) — you draw 2 cards.'),
  unit('canopy-archer', 'Canopy Archer', 6, 'ranged'),
  unit('howler-troop', 'Howler Troop', 5, 'ranged', { ability: 'bond' }, 'Bond: copies in the same row multiply each other.'),
  unit('parrot-scout', 'Parrot Scout', 4, 'ranged', { ability: 'spy' }, 'Spy: joins the enemy row (their points) — you draw 2 cards.'),
  unit('roar-herald', 'Roar Herald', 2, 'ranged', { ability: 'horn' }, 'Horn: doubles every other unit in its row.'),
  unit('prowling-cat', 'Prowling Cat', 5, 'agile', undefined, 'Agile: fights in melee or ranged — you pick.'),
  unit('stone-thrower', 'Stone Thrower', 8, 'siege'),
  unit('log-ram', 'Log Ram', 6, 'siege'),
  special('cold-snap', 'Cold Snap', 'frost', 'Weather: melee units on both sides fight at power 1.'),
  special('canopy-mist', 'Canopy Mist', 'fog', 'Weather: ranged units on both sides fight at power 1.'),
  special('monsoon', 'Monsoon', 'rain', 'Weather: siege units on both sides fight at power 1.'),
  special('clear-skies', 'Clear Skies', 'clear', 'Removes all weather from the battlefield.'),
  special('war-drums', 'War Drums', 'horn', 'Doubles every unit in one of your rows.'),
  special('wildfire', 'Wildfire', 'scorch', 'Destroys the strongest non-hero unit(s) in play — yours included.'),
];

const byId = new Map(ROWS_DEMO_CARDS.map((c) => [c.id, c]));

/** A 25-card demo deck (matches ROWS_STANDARD.deckSize). */
export function buildRowsDemoDeck(): CardDef[] {
  const list: [string, number][] = [
    ['alpha-tiger', 1], ['elder-ape', 1], ['striped-brawler', 2], ['raider-pack', 3],
    ['cub-twins', 2], ['vine-spy', 1], ['canopy-archer', 2], ['howler-troop', 2],
    ['parrot-scout', 1], ['roar-herald', 1], ['prowling-cat', 1], ['stone-thrower', 2],
    ['log-ram', 1], ['cold-snap', 1], ['canopy-mist', 1], ['clear-skies', 1],
    ['war-drums', 1], ['wildfire', 1],
  ];
  const deck: CardDef[] = [];
  for (const [id, count] of list) {
    for (let i = 0; i < count; i++) deck.push(byId.get(id)!);
  }
  return deck;
}
