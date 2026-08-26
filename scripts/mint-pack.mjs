#!/usr/bin/env node
/**
 * Preflight for minting the local card pack on TigerMint.
 *
 *   npm run mint-pack
 *
 * Validates packages/client/public/pack/pack.json and its images (aspect
 * ratios are warnings, never blockers), then points you at TigerMint's Pro
 * Wizard — the full launch experience (cover, banner, socials, description,
 * phases) lives there, and it accepts pack.json directly as the manifest.
 * Once the collection is deployed, connect the game to it via .env.local.
 */
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(root, 'packages', 'client', 'public', 'pack');
const packPath = join(packDir, 'pack.json');
const envPath = join(root, 'packages', 'client', '.env.local');

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- manifest
if (!existsSync(packPath)) {
  fail(`No pack manifest at ${packPath}\n  Copy pack.example.json to pack.json and add your cards first.`);
}
let pack;
try {
  pack = JSON.parse(readFileSync(packPath, 'utf8'));
} catch (err) {
  fail(`pack.json is not valid JSON: ${err.message}`);
}
const cards = Array.isArray(pack.cards) ? pack.cards : [];
if (cards.length === 0) fail('pack.json has no cards.');

// ------------------------------------------------------- image dimensions
function imageSize(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const len = readSync(fd, head, 0, head.length, 0);
    // PNG: IHDR width/height at fixed offsets.
    if (head.readUInt32BE(0) === 0x89504e47) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }
    // JPEG: scan segments for a SOF marker.
    if (head.readUInt16BE(0) === 0xffd8) {
      let off = 2;
      while (off < len - 9) {
        if (head[off] !== 0xff) { off += 1; continue; }
        const marker = head[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: head.readUInt16BE(off + 7), height: head.readUInt16BE(off + 5) };
        }
        off += 2 + head.readUInt16BE(off + 2);
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------- validation
console.log(`\nPack: "${pack.name ?? 'unnamed'}" — ${cards.length} cards\n`);
const warnings = [];
let missing = 0;
for (const card of cards) {
  const label = card.name ?? '(unnamed card)';
  if (!card.name) warnings.push(`⚠ a card has no name`);
  if (!card.art) { console.error(`✗ ${label}: no "art" file`); missing += 1; continue; }
  const artPath = join(packDir, card.art);
  if (!existsSync(artPath)) { console.error(`✗ ${label}: missing image ${card.art}`); missing += 1; continue; }

  const fullArt = card.style ? /full/i.test(card.style) : card.fullArt !== false;
  const size = imageSize(artPath);
  if (size) {
    const wanted = fullArt ? 3 / 4 : 1;
    const ratio = size.width / size.height;
    if (Math.abs(ratio - wanted) / wanted > 0.03) {
      warnings.push(`⚠ ${label}: ${size.width}x${size.height} — recommended ${fullArt ? '3:4' : '1:1'} for ${fullArt ? 'full-art' : 'framed'} cards`);
    }
  }
  const rarity = (card.rarity ?? '').toUpperCase();
  if (!['LEGENDARY', 'EPIC', 'RARE', 'COMMON'].includes(rarity)) {
    warnings.push(`⚠ ${label}: no rarity — will mint as COMMON`);
  }
  if (typeof card.description === 'string' && card.description.length > 500) {
    warnings.push(`⚠ ${label}: description is ${card.description.length} chars — TigerMint caps it at 500`);
  }
  const editions = card.editions ?? card.copies;
  if (editions !== undefined && (!Number.isInteger(editions) || editions < 1)) {
    warnings.push(`⚠ ${label}: editions must be a positive integer (got ${JSON.stringify(editions)})`);
  }
  console.log(`  ✓ ${label}  (${card.type ?? 'creature'}${rarity ? `, ${rarity}` : ''}${editions ? `, x${editions}` : ''})`);
}
if (missing > 0) fail(`${missing} card(s) are missing images.`);

// Supply is the print run — the sum of per-card editions, not the card count.
const declared = cards
  .map((c) => c.editions ?? c.copies)
  .filter((e) => Number.isInteger(e) && e >= 1);
const defaulted = cards.length - declared.length;
const declaredSum = declared.reduce((a, b) => a + b, 0);
if (defaulted === 0) {
  console.log(`\n  Supply: ${declaredSum} editions across ${cards.length} cards`);
} else if (declared.length === 0) {
  console.log(`\n  Supply: rarity-tier default print runs for all ${cards.length} cards`);
  console.log('  (set "editions" per card to control each print run)');
} else {
  console.log(`\n  Supply: ${declaredSum} declared editions across ${declared.length} cards,`);
  console.log(`  plus rarity-tier default print runs for the other ${defaulted}`);
}

if (warnings.length > 0) {
  console.log('');
  for (const w of warnings) console.log(`  ${w}`);
  console.log('  (warnings never block a launch)');
}

// ----------------------------------------------------------------- next steps
const url = 'https://mint.tendytiger.lol/project/submit?template=cards';
console.log(`\n✓ Preflight passed. Mint the pack in TigerMint's card-set wizard:\n  ${url}\n`);
console.log('  1. The Card Set template preconfigures import mode; per-card names,');
console.log('     descriptions, and editions land in the wizard\'s card editor.');
console.log(`  2. Drop the ${cards.length} card images and pack.json itself (accepted as the`);
console.log('     manifest) from packages/client/public/pack/.');
console.log('  3. Add your cover, banner, description, socials, and mint phases,');
console.log('     then sign the deploy with your wallet.');
console.log('  4. Connect the game to the live drop in packages/client/.env.local:');
console.log('       VITE_NFT_COLLECTION=<collection address>');
console.log('       VITE_TIGERMINT_SLUG=<slug>          (enables in-game pulls)');
console.log('       VITE_TIGERMINT_API_KEY=<tgm_...>    (key from /developers)\n');
const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
if (!/^\s*VITE_TIGERMINT_API_KEY\s*=\s*\S+/m.test(env)) {
  console.log('  Note: no VITE_TIGERMINT_API_KEY in .env.local yet — the in-game pull');
  console.log('  panel stays in demo mode until you add one.\n');
}
const opener = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
exec(opener, () => { /* best effort — the URL is printed either way */ });
