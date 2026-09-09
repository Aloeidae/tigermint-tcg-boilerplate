#!/usr/bin/env python3
"""
Sticker League card generator.

Reads:  data/roster.csv, data/types.json, data/move_templates.json,
        data/traits.json, data/trainers.json, data/overrides.json (optional)
Writes: out/cards.json          canonical Sticker League metadata (new engine)
        out/pack.json           the ONE file TigerMint's Card Set wizard needs:
                                legacy fields (untouched boilerplate engine) +
                                `attributes` (minted verbatim as display traits,
                                incl. Card ID; TigerMint appends Rarity itself) +
                                the full `game` block per card. TigerMint pins
                                this file at launch and serves it byte-for-byte
                                at /api/v1/collections/{slug}/pack.json — it is
                                world-readable, so keep secrets out of it.
        out/nft_attributes.json the same attribute arrays standalone (legacy)
        out/starter_decks.json  eight mono-type 30-card Quick-format decks
        out/balance_report.md   distributions + rule-violation flags

Deterministic: the same roster + seed always produce the same cards, so you
can re-run after editing templates without shuffling everything else.

    python3 scripts/generate_cards.py --seed 20260904
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

STAGE_NAMES = ["Static", "Animated", "Premium"]
RARITY_EDITIONS = {"COMMON": 40, "RARE": 25, "EPIC": 12, "LEGENDARY": 5}

# HP curve (base, before role/trait adjustment). Values are inclusive ranges.
HP_TABLE = {
    "L": [(70, 70), (110, 120), (170, 190)],
    "E": [(60, 70), (90, 110)],
    "S": [(110, 130)],
    "C": [(60, 90)],
}
# Damage curve keyed by [damage tier][cost count] -> (lo, hi). Tier 0 = Static,
# 1 = Animated, 2 = Premium and Star Stickers.
DMG_TABLE = {
    0: {1: (10, 20), 2: (20, 30), 3: (40, 50)},
    1: {1: (20, 30), 2: (40, 50), 3: (70, 80), 4: (100, 100)},
    2: {1: (30, 30), 2: (60, 60), 3: (90, 110), 4: (130, 150)},
}
ROLE_HP = {"Bruiser": 20, "Striker": -10, "Support": 0, "Trickster": -10}
ROLE_DMG = {"Bruiser": -10, "Striker": 10, "Support": 0, "Trickster": 0}
TRAIT_CHANCE = {"Static": 0.15, "Animated": 0.40, "Premium": 0.60, "Star": 0.50}

# Trait -> boilerplate skill string, for the legacy (pre-port) mapping.
LEGACY_SKILLS = {
    "thick_skin": "Armor 2", "pinned_comment": "Guard", "self_care": "Regenerate",
    "free_swap": "Haste", "viral": "Scavenger", "auto_reply": "Venomous",
    "backup": "Inspiring", "premium_glow": "Armor 1", "grounded": "Armor 1",
}


def r10(x: float) -> int:
    return int(round(x / 10.0)) * 10


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load_json(name: str, default=None):
    p = DATA / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def tier_for_rank(rank: int) -> str:
    if rank <= 10:
        return "L"
    if rank <= 40:
        return "E"
    if rank <= 90:
        return "S"
    return "C"


# ---------------------------------------------------------------------------
# Move construction
# ---------------------------------------------------------------------------
def describe_effects(effects: list[dict], status_type: str | None) -> str:
    parts = []
    for e in effects:
        op = e["op"]
        if op == "status":
            amt = e.get("amount")
            extra = f" (places {amt} damage between turns)" if amt else ""
            parts.append(f"The opponent's Pinned Sticker is now {e['status']}{extra}.")
        elif op == "flipStatus":
            parts.append(f"Flip a coin. If heads, the opponent's Pinned Sticker is now {e['status']}.")
        elif op == "flipBonus":
            parts.append(f"Flip a coin. If heads, this Move does {e['bonus']} more damage.")
        elif op == "flipDamage":
            parts.append(f"Flip {e['flips']} coins. This Move does {e['perHeads']} damage for each heads.")
        elif op == "benchDamage":
            n = e.get("targets", 1)
            who = "1 of the opponent's Chat Stickers" if n == 1 else f"up to {n} of the opponent's Chat Stickers"
            parts.append(f"This Move also does {e['amount']} damage to {who}. (Don't apply Weakness or Resistance.)")
        elif op == "selfDamage":
            parts.append(f"This Sticker also does {e['amount']} damage to itself.")
        elif op == "discardEnergy":
            n = e.get("count", 1)
            tgt = "this Sticker" if e.get("from") == "self" else "the opponent's Pinned Sticker"
            parts.append(f"Discard {n} Reaction{'s' if n > 1 else ''} from {tgt}.")
        elif op == "heal":
            tgt = {"self": "this Sticker", "all": "each of your Stickers"}.get(e.get("target"), "this Sticker")
            parts.append(f"Heal {e['amount']} damage from {tgt}.")
        elif op == "draw":
            parts.append(f"Draw {e['count']} card{'s' if e['count'] > 1 else ''}.")
        elif op == "lockSwap":
            parts.append("The opponent's Pinned Sticker can't Swap during their next turn.")
        elif op == "priority":
            parts.append("If this Sticker was put into play this turn, this Move can still be used.")
        elif op == "searchEnergy":
            where = "this Sticker" if e.get("attachTo") == "self" else "one of your Chat Stickers"
            parts.append(f"Search your Feed for a {e['type']} Reaction and attach it to {where}. Shuffle your Feed.")
        elif op == "reduceDamageNextTurn":
            parts.append(f"During the opponent's next turn, this Sticker takes {e['amount']} less damage from Moves.")
        elif op == "bonusPerBench":
            parts.append(f"This Move does {e['amount']} more damage for each Sticker on your Chat.")
        elif op == "revealHand":
            parts.append("Your opponent reveals their hand.")
        elif op == "protect":
            parts.append("During the opponent's next turn, prevent all damage done to this Sticker by Moves.")
        elif op == "copyMove":
            parts.append("Choose 1 of the opponent's Pinned Sticker's Moves and use it as this Move.")
        else:
            parts.append(op)
    return " ".join(parts)


def build_move(rng: random.Random, tmpl: dict, ctype: str, dmg_tier: int, role: str, neutral: str) -> dict:
    cost = [ctype if c == "T" else neutral for c in tmpl["cost"]]
    n = len(cost)
    lo, hi = DMG_TABLE[dmg_tier].get(n, DMG_TABLE[dmg_tier][max(DMG_TABLE[dmg_tier])])
    base = rng.choice(range(lo, hi + 1, 10)) + ROLE_DMG[role]
    effects = json.loads(json.dumps(tmpl["effects"]))
    damage = max(0, r10(base - tmpl["price"]))
    if n == 1:
        damage = min(damage, {0: 20, 1: 30, 2: 40}[dmg_tier])  # 1-cost ceilings (weakness safety on Statics)
    if not effects:
        damage = max(damage, 10)  # a vanilla Move always does something
    ev = damage
    text_bits = []
    for e in effects:
        if e["op"] == "flipDamage":
            # Scale the per-heads value so expected value sits on the curve.
            per = max(10, r10(2 * max(base, 10) / e["flips"]))
            e["perHeads"] = per
            damage = 0
            ev = per * e["flips"] / 2
        elif e["op"] == "flipBonus":
            ev = damage + e["bonus"] / 2
        elif e["op"] == "bonusPerBench":
            ev = damage + 2 * e["amount"]
    text = describe_effects(effects, None)
    return {
        "name": tmpl["name"],
        "cost": cost,
        "damage": damage,
        "damageText": (f"{effects[0]['perHeads']}×" if damage == 0 and effects and effects[0]["op"] == "flipDamage" else str(damage or "")),
        "expectedDamage": int(ev),
        "text": text,
        "effects": effects,
    }


def pick_moves(rng: random.Random, ctype: str, stage_idx: int, dmg_tier: int, role: str,
               templates: dict, neutral: str, star: bool, used_names: set[str] = frozenset()) -> list[dict]:
    pool = templates["shared"] + templates["byType"].get(ctype, [])
    stage_gate = 1 if star else stage_idx
    pool = [t for t in pool if t["minStage"] <= stage_gate and t["name"] not in used_names]
    # Role bias: Tricksters prefer status moves, Supports prefer heal/draw, Strikers vanilla/drawback.
    def weight(t):
        ops = {e["op"] for e in t["effects"]}
        w = 1.0
        if role == "Trickster" and ops & {"status", "flipStatus", "lockSwap", "discardEnergy"}: w = 3.0
        if role == "Support" and ops & {"heal", "draw", "searchEnergy", "protect"}: w = 3.0
        if role == "Striker" and (not ops or ops & {"selfDamage", "flipBonus", "flipDamage"}): w = 2.5
        if role == "Bruiser" and (not ops or ops & {"reduceDamageNextTurn", "bonusPerBench", "selfDamage"}): w = 2.5
        return w

    two_moves = star or stage_idx >= 1 or rng.random() < 0.55
    cheap = [t for t in pool if len(t["cost"]) <= 2]
    first = rng.choices(cheap, weights=[weight(t) for t in cheap], k=1)[0]
    moves = [build_move(rng, first, ctype, dmg_tier, role, neutral)]
    if two_moves:
        big = [t for t in pool if len(t["cost"]) > len(first["cost"]) and t["name"] != first["name"]
               and (len(t["cost"]) <= 3 or dmg_tier >= 1)]
        if big:
            second = rng.choices(big, weights=[weight(t) for t in big], k=1)[0]
            moves.append(build_move(rng, second, ctype, dmg_tier, role, neutral))
    return moves


# ---------------------------------------------------------------------------
# Card construction
# ---------------------------------------------------------------------------
def pick_trait(rng: random.Random, ctype: str, role: str, stage_label: str, traits: list[dict]) -> dict | None:
    chance = 1.0 if role == "Support" else TRAIT_CHANCE[stage_label]
    if rng.random() > chance:
        return None
    ok = [t for t in traits if (not t["types"] or ctype in t["types"]) and (not t["roles"] or role in t["roles"])]
    if not ok:
        ok = [t for t in traits if not t["types"] and not t["roles"]]
    return rng.choice(ok) if ok else None


def swap_cost(hp: int, role: str, trait: dict | None) -> int:
    if trait and trait["key"] == "free_swap":
        return 0
    c = 1 if hp <= 70 else 2 if hp <= 110 else 3 if hp <= 160 else 4
    if role == "Trickster":
        c -= 1
    if role == "Bruiser":
        c += 1
    return max(0, min(4, c))


def flavor(row: dict, stage_label: str, ctype: str, types_json: dict) -> str:
    ident = types_json["types"][ctype]["identity"]
    rank = int(row["rank"])
    name = row["pack_title"] or f"Trending #{rank:03d}"
    if row.get("placeholder") == "1":
        return f"Placeholder for trending sticker pack #{rank:03d}. {stage_label} form. Style: {ident}."
    return f"{name} — trending #{rank}. {stage_label} form. Style: {ident}."


def make_sticker(row: dict, stage_idx: int, star: bool, tier: str, prev_card: dict | None,
                 seed: int, types_json, templates, traits) -> dict:
    rank = int(row["rank"])
    rng = random.Random(f"{seed}:{rank}:{stage_idx}:{int(star)}")
    ctype = row["type"] if row["type"] in types_json["types"] else "Neutral"
    role = row["role"] if row["role"] in ROLE_HP else "Striker"
    order = types_json["order"]
    neutral = types_json["neutral"]
    stage_label = "Star" if star else STAGE_NAMES[stage_idx]
    dmg_tier = 2 if (star or stage_idx == 2) else stage_idx

    trait = pick_trait(rng, ctype, role, stage_label, traits)
    lo, hi = HP_TABLE[tier][stage_idx]
    hp = rng.choice(range(lo, hi + 1, 10)) + ROLE_HP[role] - (trait["hpTax"] if trait else 0)
    hp = max({0: 60, 1: 90, 2: 150}[stage_idx] if not star else 110, r10(hp))
    if prev_card:
        hp = max(hp, prev_card["hp"] + 20)

    used = {m["name"] for m in prev_card["moves"]} if prev_card else set()
    moves = pick_moves(rng, ctype, stage_idx, dmg_tier, role, templates, neutral, star, used)

    if ctype in order:
        i = order.index(ctype)
        weakness = order[(i + 1) % len(order)]
        resistance = order[(i - 2) % len(order)] if rng.random() < types_json["resistanceChance"] else None
    else:
        weakness, resistance = "Solid", None
    if trait and trait["key"] == "grounded":
        weakness = None

    character = row["character"] or f"Trending #{rank:03d}"
    if star:
        name, rarity = f"{character} ★", "RARE"
    elif stage_idx == 0:
        name = character
        rarity = "COMMON"
    elif stage_idx == 1:
        name = f"Animated {character}"
        rarity = "EPIC" if tier == "L" else "RARE"
    else:
        name = f"Premium {character}"
        rarity = "LEGENDARY"

    card_id = f"stk-{rank:03d}-{'star' if star else stage_idx}-{slug(character)}"
    best = max(moves, key=lambda m: m["expectedDamage"])
    legacy_skills = [LEGACY_SKILLS[trait["key"]]] if trait and trait["key"] in LEGACY_SKILLS else []
    legacy = {
        "type": "creature",
        "cost": max(1, min(10, len(best["cost"]) + (1 if stage_idx == 2 or star else 0))),
        "attack": max(1, int(round(best["expectedDamage"] / 10))),
        "health": max(1, hp // 10),
        "skills": legacy_skills,
    }
    return {
        "id": card_id,
        "kind": "sticker",
        "name": name,
        "character": character,
        "stickerPack": {
            "title": row["pack_title"] or None,
            "shortName": row["pack_short_name"] or None,
            "url": row["pack_url"] or None,
            "trendingRank": rank,
            "verified": row.get("verified") == "1",
            "placeholder": row.get("placeholder") == "1",
        },
        "stage": STAGE_NAMES[stage_idx],
        "stageIndex": stage_idx,
        "star": star,
        "upgradesFrom": prev_card["id"] if prev_card else None,
        "type": ctype,
        "typeEmoji": types_json["types"][ctype]["emoji"],
        "role": role,
        "hp": hp,
        "trait": ({"key": trait["key"], "name": trait["name"], "text": trait["text"],
                   "trigger": trait["trigger"], "effects": trait["effects"]} if trait else None),
        "moves": moves,
        "weakness": weakness,
        "resistance": resistance,
        "swapCost": swap_cost(hp, role, trait),
        "starsOnKO": 2 if star else 1,
        "rarity": rarity,
        "editions": RARITY_EDITIONS[rarity],
        "art": f"{slug(card_id)}.png",
        "description": flavor(row, stage_label, ctype, types_json),
        "legacy": legacy,
    }


def make_line(row: dict, seed: int, types_json, templates, traits) -> list[dict]:
    tier = tier_for_rank(int(row["rank"]))
    if tier == "S":
        return [make_sticker(row, 0, True, tier, None, seed, types_json, templates, traits)]
    stages = {"L": 3, "E": 2, "C": 1}[tier]
    cards, prev = [], None
    for s in range(stages):
        c = make_sticker(row, s, False, tier, prev, seed, types_json, templates, traits)
        cards.append(c)
        prev = c
    return cards


# ---------------------------------------------------------------------------
# Trainers, NFT attributes, pack manifest
# ---------------------------------------------------------------------------
def make_trainer(raw: dict, types_json) -> dict:
    kind = raw["kind"]
    card = {
        "id": raw["id"], "kind": kind, "name": raw["name"], "rarity": raw["rarity"],
        "text": raw["text"], "effects": raw.get("effects", []),
        "editions": raw.get("editions", RARITY_EDITIONS[raw["rarity"]]),
        "art": f"{slug(raw['id'])}.png",
        "description": raw["text"],
        "legacy": raw.get("legacy", {"type": "spell", "cost": 1, "effect": "draw 1"}),
    }
    if "basic" in raw:
        card["basic"] = raw["basic"]
    if kind == "reaction":
        card["type"] = raw["type"]
        card["special"] = raw.get("special", False)
        card["provides"] = raw.get("provides", [raw["type"]])
        card["typeEmoji"] = types_json["types"].get(raw["type"], {}).get("emoji", "👀")
    return card


def nft_attributes(card: dict) -> list[dict]:
    """Attribute list for TigerMint / NFT metadata. The boilerplate mapper reads the
    legacy keys (Type/Cost/Attack/Health/Skills/Spell Effect/Card Name); the ported
    engine matches cards to the served pack manifest by Card ID and reads the full
    `game` block from there — the Sticker League keys here are display/filter traits.
    TigerMint caps (verified): <=50 traits/card, trait_type <=64 chars, value <=256
    chars. TigerMint appends its own "Rarity" trait at serve time for rarity-bearing
    collections, so we must NOT emit one (it would duplicate)."""
    a = []
    lg = card["legacy"]
    a.append({"trait_type": "Card ID", "value": card["id"]})
    a.append({"trait_type": "Card Name", "value": card["name"]})
    a.append({"trait_type": "Type", "value": lg["type"]})
    a.append({"trait_type": "Cost", "value": lg["cost"]})
    if lg["type"] != "spell":
        a.append({"trait_type": "Attack", "value": lg.get("attack", 0)})
        a.append({"trait_type": "Health", "value": lg.get("health", 1)})
    if lg.get("skills"):
        a.append({"trait_type": "Skills", "value": ", ".join(lg["skills"])})
    if lg.get("effect"):
        a.append({"trait_type": "Spell Effect", "value": lg["effect"]})
    a.append({"trait_type": "Card Style", "value": "full art"})
    # --- Sticker League ---
    a.append({"trait_type": "Card Kind", "value": card["kind"]})
    if card["kind"] == "sticker":
        a += [
            {"trait_type": "Character", "value": card["character"]},
            {"trait_type": "Sticker Pack", "value": card["stickerPack"]["title"] or ""},
            {"trait_type": "Sticker Pack Link", "value": card["stickerPack"]["url"] or ""},
            {"trait_type": "Trending Rank", "value": card["stickerPack"]["trendingRank"]},
            {"trait_type": "Stage", "value": "Star" if card["star"] else card["stage"]},
            {"trait_type": "Reaction Type", "value": card["type"]},
            {"trait_type": "HP", "value": card["hp"]},
            {"trait_type": "Weakness", "value": card["weakness"] or "None"},
            {"trait_type": "Resistance", "value": card["resistance"] or "None"},
            {"trait_type": "Swap Cost", "value": card["swapCost"]},
            {"trait_type": "Stars On KO", "value": card["starsOnKO"]},
            {"trait_type": "Upgrades From", "value": card["upgradesFrom"] or ""},
        ]
        if card["trait"]:
            a.append({"trait_type": "Trait", "value": card["trait"]["name"]})
            a.append({"trait_type": "Trait Text", "value": card["trait"]["text"]})
        for i, m in enumerate(card["moves"], 1):
            a.append({"trait_type": f"Move {i}", "value": m["name"]})
            a.append({"trait_type": f"Move {i} Cost", "value": " ".join(m["cost"])})
            a.append({"trait_type": f"Move {i} Damage", "value": m["damageText"] or "0"})
            if m["text"]:
                a.append({"trait_type": f"Move {i} Text", "value": m["text"]})
    else:
        a.append({"trait_type": "Rules Text", "value": card["text"]})
        if card["kind"] == "reaction":
            a.append({"trait_type": "Reaction Type", "value": card["type"]})
            a.append({"trait_type": "Special", "value": "Yes" if card["special"] else "No"})
    # TigerMint caps: value <=256 chars, <=50 traits. Clamp defensively.
    for t in a:
        if isinstance(t["value"], str) and len(t["value"]) > 256:
            t["value"] = t["value"][:253] + "..."
    return a[:50]


def pack_entry(card: dict) -> dict:
    lg = card["legacy"]
    e = {
        "id": card["id"], "name": card["name"], "type": lg["type"], "cost": lg["cost"],
        "art": card["art"], "fullArt": True, "rarity": card["rarity"],
        "description": card["description"][:500], "editions": card["editions"],
    }
    if lg["type"] in ("creature", "equipment"):
        e["attack"], e["health"] = lg.get("attack", 0), lg.get("health", 1)
    if lg.get("skills"):
        e["skills"] = lg["skills"]
    if lg.get("effect"):
        e["effect"] = lg["effect"]
    if "basic" in card:
        e["basic"] = card["basic"]
    # TigerMint mints these verbatim (its wizard skips its legacy fixed-field
    # mapping when an `attributes` array is present); the boilerplate ignores
    # them locally and matches minted NFTs back to this entry by Card ID.
    e["attributes"] = nft_attributes(card)
    game = {k: v for k, v in card.items() if k not in ("legacy", "art", "description", "editions", "rarity", "name", "id")}
    e["game"] = game
    return e


# ---------------------------------------------------------------------------
# Starter decks (Quick format, 30 cards)
# ---------------------------------------------------------------------------
def starter_decks(stickers: list[dict], trainers: list[dict], types_json) -> list[dict]:
    decks = []
    by_type = defaultdict(list)
    for s in stickers:
        by_type[s["type"]].append(s)
    tid = {t["id"]: t for t in trainers}
    for ctype in types_json["order"]:
        pool = by_type[ctype]
        statics = [s for s in pool if s["stageIndex"] == 0 and not s["star"]]
        lines = [s for s in statics if any(x["upgradesFrom"] == s["id"] for x in pool)]
        anim = [x for x in pool if x["stageIndex"] == 1]
        star = [s for s in pool if s["star"]]
        chosen = []
        # 2 evolving lines x2 statics + their animated, 1 star, 2 solo statics.
        for line in lines[:2]:
            chosen += [line["id"]] * 2
            chosen += [x["id"] for x in anim if x["upgradesFrom"] == line["id"]] * 1
        if star:
            chosen.append(star[0]["id"])
        for s in [s for s in statics if s not in lines][:2]:
            chosen.append(s["id"])
        chosen = chosen[:10]
        reactions = [f"reaction-{ctype.lower()}"] * 11 + ["reaction-double-tap"]
        tr = ["admin-group-admin"] * 2 + ["bot-ping"] * 2 + ["bot-boost", "bot-edit-message",
              "admin-community-manager", "bot-unpin"]
        cards = chosen + reactions + tr
        cards = cards[:30]
        while len(cards) < 30:
            cards.append(f"reaction-{ctype.lower()}")
        decks.append({
            "name": f"{types_json['types'][ctype]['emoji']} {ctype} Starter",
            "format": "quick", "type": ctype, "cards": cards,
            "_valid": all(c in tid or any(s["id"] == c for s in stickers) for c in cards),
        })
    return decks


# ---------------------------------------------------------------------------
# Balance report
# ---------------------------------------------------------------------------
def balance_report(stickers: list[dict], trainers: list[dict], types_json) -> str:
    L = []
    L.append("# Sticker League — Balance Report\n")
    L.append(f"Sticker cards: {len(stickers)} · Trainer/Reaction cards: {len(trainers)} · Total: {len(stickers) + len(trainers)}\n")

    L.append("## Counts\n")
    L.append("| Stage | Cards | Avg HP | Avg best-move EV | EV per Reaction |\n|---|---|---|---|---|")
    for label in ["Static", "Animated", "Premium", "Star"]:
        grp = [s for s in stickers if (s["star"] if label == "Star" else (not s["star"] and s["stage"] == label))]
        if not grp:
            continue
        hp = sum(s["hp"] for s in grp) / len(grp)
        best = [max(s["moves"], key=lambda m: m["expectedDamage"]) for s in grp]
        ev = sum(b["expectedDamage"] for b in best) / len(best)
        evpe = sum(b["expectedDamage"] / max(1, len(b["cost"])) for b in best) / len(best)
        L.append(f"| {label} | {len(grp)} | {hp:.0f} | {ev:.0f} | {evpe:.1f} |")
    L.append("")

    L.append("| Rarity | Stickers | Trainers | Editions (total) |\n|---|---|---|---|")
    for r in ["COMMON", "RARE", "EPIC", "LEGENDARY"]:
        sc = [s for s in stickers if s["rarity"] == r]
        tc = [t for t in trainers if t["rarity"] == r]
        L.append(f"| {r} | {len(sc)} | {len(tc)} | {sum(c['editions'] for c in sc + tc)} |")
    L.append("")

    L.append("| Type | Stickers | Avg HP | Traits |\n|---|---|---|---|")
    for t in types_json["order"] + ["Neutral"]:
        grp = [s for s in stickers if s["type"] == t]
        if grp:
            L.append(f"| {types_json['types'][t]['emoji']} {t} | {len(grp)} | {sum(s['hp'] for s in grp)/len(grp):.0f} | {sum(1 for s in grp if s['trait'])} |")
    L.append("")

    # Rule checks
    flags = []
    by_id = {s["id"]: s for s in stickers}
    statics = [s for s in stickers if s["stageIndex"] == 0 and not s["star"]]
    for a in statics:
        one_cost = [m for m in a["moves"] if len(m["cost"]) == 1]
        if not one_cost:
            continue
        dmg = max(m["expectedDamage"] for m in one_cost)
        victims = [b for b in statics if b["weakness"] == a["type"] and tier_for_rank(b["stickerPack"]["trendingRank"]) == tier_for_rank(a["stickerPack"]["trendingRank"])]
        for b in victims:
            if dmg * types_json["weaknessMultiplier"] >= b["hp"]:
                flags.append(f"ONE-SHOT: {a['name']} ({a['type']}) 1-cost {dmg} ×2 KOs {b['name']} ({b['hp']} HP)")
    premiums = [s for s in stickers if s["stageIndex"] == 2 or s["star"]]
    anims = [s for s in stickers if s["stageIndex"] == 1]
    for p in premiums:
        hunters = [a for a in anims if a["type"] == p["weakness"]]
        if not hunters:
            continue
        best = max(max(m["expectedDamage"] for m in a["moves"]) for a in hunters)
        hits = -(-p["hp"] // max(1, best * 2))
        if hits > 3:
            flags.append(f"TOO-TANKY: {p['name']} ({p['hp']} HP) needs {hits} hits from the best weak-type Animated ({best}×2)")
    for s in stickers:
        for m in s["moves"]:
            if m["expectedDamage"] == 0 and not m["effects"]:
                flags.append(f"DEAD MOVE: {s['name']} / {m['name']}")
        if s["upgradesFrom"] and by_id[s["upgradesFrom"]]["hp"] >= s["hp"]:
            flags.append(f"HP REGRESSION: {s['name']} {s['hp']} ≤ {by_id[s['upgradesFrom']]['name']} {by_id[s['upgradesFrom']]['hp']}")
    L.append("## Rule checks\n")
    L.append("Rules: no Static one-shots a same-tier Static via Weakness with a 1-cost Move; every Premium/Star dies in ≤3 hits to the best weak-type Animated; no dead Moves; upgrades never lose HP.\n")
    if flags:
        L += [f"- {f}" for f in flags]
    else:
        L.append("All checks passed.")
    L.append("")
    L.append("## Placeholders\n")
    ph = sorted({s["stickerPack"]["trendingRank"] for s in stickers if s["stickerPack"]["placeholder"]})
    L.append(f"{len(ph)} roster slots are placeholders (ranks {ph[0]}–{ph[-1]}). Run `scripts/fetch_featured_stickers.py` or fill `data/roster.csv` by hand, then re-generate." if ph else "No placeholder slots.")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", default=str(DATA / "roster.csv"))
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--seed", type=int, default=20260904)
    ap.add_argument("--set-name", default="Sticker League: Trending Set 1")
    args = ap.parse_args()

    types_json = load_json("types.json")
    templates = load_json("move_templates.json")
    traits = load_json("traits.json")["traits"]
    trainers_raw = load_json("trainers.json")["cards"]
    overrides = load_json("overrides.json", {}) or {}

    with open(args.roster, newline="", encoding="utf-8") as f:
        roster = [r for r in csv.DictReader(f) if r.get("rank")]
    roster.sort(key=lambda r: int(r["rank"]))

    stickers: list[dict] = []
    for row in roster:
        stickers += make_line(row, args.seed, types_json, templates, traits)
    trainers = [make_trainer(t, types_json) for t in trainers_raw]

    # Designer overrides: { "<card id>": { "hp": 120, "moves": [...] , ... } }
    for c in stickers + trainers:
        if c["id"] in overrides:
            c.update(overrides[c["id"]])

    all_cards = stickers + trainers
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    (out / "cards.json").write_text(json.dumps({
        "set": args.set_name, "version": "0.1", "seed": args.seed, "rules": "RULESET.md",
        "types": types_json, "cards": all_cards,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    (out / "pack.json").write_text(json.dumps({
        "name": args.set_name,
        "_readme": "Generated by scripts/generate_cards.py. Top-level fields are the Tigermint boilerplate's legacy schema so the pack plays in the untouched engine; `game` holds the full Sticker League card for the ported engine. Copy to packages/client/public/pack/pack.json.",
        "cards": [pack_entry(c) for c in all_cards],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    (out / "nft_attributes.json").write_text(json.dumps(
        {c["id"]: {"name": c["name"], "image": c["art"], "description": c["description"][:500],
                   "attributes": nft_attributes(c)} for c in all_cards},
        ensure_ascii=False, indent=2), encoding="utf-8")

    (out / "starter_decks.json").write_text(json.dumps(
        starter_decks(stickers, trainers, types_json), ensure_ascii=False, indent=2), encoding="utf-8")

    (out / "balance_report.md").write_text(balance_report(stickers, trainers, types_json), encoding="utf-8")

    print(f"stickers={len(stickers)} trainers={len(trainers)} total={len(all_cards)} -> {out}")


if __name__ == "__main__":
    main()
