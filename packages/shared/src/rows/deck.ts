import type { CardDef } from '../types.js';
import type { RulesConfig } from '../rules.js';

/**
 * Deck legality for the rows mode: every card needs a rows block, most of the
 * deck must be units (the round is won on power), and specials are capped so
 * a deck can't be all weather and scorch.
 */
export function validateRowsDeck(defs: CardDef[], rules: RulesConfig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (defs.length !== rules.deckSize) {
    errors.push(`Deck must be exactly ${rules.deckSize} cards (got ${defs.length})`);
  }
  const missing = defs.filter((d) => !d.rows);
  if (missing.length > 0) {
    errors.push(`${missing.length} card${missing.length === 1 ? ' is' : 's are'} not playable in rows mode: ${[...new Set(missing.map((d) => d.name))].slice(0, 4).join(', ')}`);
  }
  const specials = defs.filter((d) => d.rows?.kind === 'special').length;
  if (specials > 10) errors.push(`At most 10 specials (got ${specials})`);
  const units = defs.filter((d) => d.rows?.kind === 'unit').length;
  const minUnits = Math.max(1, rules.deckSize - 10);
  if (units < minUnits) errors.push(`At least ${minUnits} units (got ${units})`);
  return { ok: errors.length === 0, errors };
}
