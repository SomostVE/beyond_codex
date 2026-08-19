import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareGameCardOrderAllClasses } from "./card-sort.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "api", "v1");
const CLASS_DIR = path.join(API_DIR, "classes");
const CARDS_PATH = path.join(API_DIR, "cards.json");
const META_PATH = path.join(API_DIR, "metadata.json");
const CHANGELOG_PATH = path.join(API_DIR, "changelog.json");
const MANIFEST_PATH = path.join(API_DIR, "manifest.json");

const SOURCE_API = "https://shadowverse-wb.com/web/CardList/cardList";
const IMAGE_BASE = "https://shadowverse-wb.com/uploads/card_image/eng/card/";
const LEGACY_BASE = "https://raw.githubusercontent.com/SomostVE/beyond_decks/main/data/official/";
const SCHEMA_VERSION = 1;

const CLASS_NAMES = {
  0: "Neutral",
  1: "Forestcraft",
  2: "Swordcraft",
  3: "Runecraft",
  4: "Dragoncraft",
  5: "Abysscraft",
  6: "Havencraft",
  7: "Portalcraft"
};

const TYPE_NAMES = { 1: "Follower", 2: "Amulet", 3: "Amulet", 4: "Spell" };
const RARITY_NAMES = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Legendary" };
const TRACKED_FIELDS = [
  "name", "class", "setId", "set", "type", "rarity", "cost", "attack", "defense",
  "traits", "keywords", "text", "rawSkillText", "rotation", "token", "maxCopies",
  "relatedCards", "imageHash", "evolved", "styles", "questions"
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchPage(offset) {
  const url = new URL(SOURCE_API);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("class", "0,1,2,3,4,5,6,7");
  url.searchParams.set("cost", "0,1,2,3,4,5,6,7,8,9,10");
  url.searchParams.set("include_token", "1");

  return fetchJson(url, {
    headers: {
      lang: "en",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Beyond Codex GitHub Actions)"
    }
  });
}

function cleanSkillText(value) {
  return String(value ?? "")
    .replace(/<hr\s*\/?\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractKeywords(skillText) {
  const raw = String(skillText ?? "");
  const found = new Set();
  for (const match of raw.matchAll(/<color=Keyword>(.*?)<\/color>/g)) {
    const value = String(match[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/_\d+$/g, "")
      .trim();
    if (value && !value.startsWith("Quest:") && !value.includes("Deck")) found.add(value);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function normalizeCard(id, detail, relations, dictionaries) {
  const common = detail.common ?? {};
  const evo = detail.evo && !Array.isArray(detail.evo) ? detail.evo : null;
  const traits = (common.tribes ?? [])
    .map(traitId => dictionaries.tribeNames[String(traitId)])
    .filter(name => name && name !== "-");
  const related = relations?.related_card_ids ?? [];

  return {
    id: Number(common.card_id ?? id),
    baseCardId: Number(common.base_card_id ?? common.card_id ?? id),
    name: common.name ?? "",
    class: CLASS_NAMES[Number(common.class)] ?? `Class ${common.class}`,
    setId: Number(common.card_set_id ?? 0),
    set: dictionaries.setNames[String(common.card_set_id)] ?? String(common.card_set_id ?? ""),
    type: TYPE_NAMES[Number(common.type)] ?? `Type ${common.type}`,
    rarity: RARITY_NAMES[Number(common.rarity)] ?? `Rarity ${common.rarity}`,
    cost: Number(common.cost ?? 0),
    attack: Number(common.atk ?? 0),
    defense: Number(common.life ?? 0),
    traits,
    keywords: extractKeywords(common.skill_text),
    text: cleanSkillText(common.skill_text),
    rawSkillText: common.skill_text ?? "",
    flavourText: common.flavour_text ?? "",
    rotation: Boolean(common.is_include_rotation),
    token: Boolean(common.is_token),
    maxCopies: Number(common.deck_enabled_num ?? 3),
    relatedCards: related.map(Number),
    image: common.card_image_hash ? `${IMAGE_BASE}${common.card_image_hash}.png` : null,
    imageHash: common.card_image_hash ?? null,
    bannerImageHash: common.card_banner_image_hash ?? null,
    evolved: evo ? {
      text: cleanSkillText(evo.skill_text),
      rawSkillText: evo.skill_text ?? "",
      flavourText: evo.flavour_text ?? "",
      image: evo.card_image_hash ? `${IMAGE_BASE}${evo.card_image_hash}.png` : null,
      imageHash: evo.card_image_hash ?? null,
      bannerImageHash: evo.card_banner_image_hash ?? null
    } : null,
    styles: (detail.style_card_list ?? []).map(style => ({
      name: style.name ?? "",
      image: style.hash ? `${IMAGE_BASE}${style.hash}.png` : null,
      evolvedImage: style.evo_hash ? `${IMAGE_BASE}${style.evo_hash}.png` : null
    })),
    questions: common.questions ?? []
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadPreviousSnapshot() {
  const localCards = await readJson(CARDS_PATH, null);
  const localMeta = await readJson(META_PATH, null);
  if (Array.isArray(localCards) && localCards.length) {
    console.log(`Using Beyond Codex baseline: ${localCards.length} cards`);
    return { cards: localCards, metadata: localMeta ?? {} };
  }

  console.log("No Codex baseline yet; importing the last embedded Beyond Decks snapshot...");
  try {
    const [cards, metadata] = await Promise.all([
      fetchJson(`${LEGACY_BASE}cards.json`),
      fetchJson(`${LEGACY_BASE}metadata.json`).catch(() => ({}))
    ]);
    if (!Array.isArray(cards) || !cards.length) throw new Error("Legacy cards.json was empty");
    console.log(`Imported legacy baseline: ${cards.length} cards`);
    return { cards, metadata };
  } catch (error) {
    console.warn(`Legacy baseline unavailable: ${error.message}`);
    return { cards: [], metadata: {} };
  }
}

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return JSON.stringify(value);
}

function compareCard(previous, current) {
  const changes = [];
  for (const field of TRACKED_FIELDS) {
    if (stable(previous?.[field]) === stable(current?.[field])) continue;
    changes.push({ field, before: previous?.[field] ?? null, after: current?.[field] ?? null });
  }
  return changes;
}

function summary(card) {
  return {
    id: Number(card.id),
    name: card.name ?? "",
    class: card.class ?? "",
    set: card.set ?? "",
    rarity: card.rarity ?? ""
  };
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const previous = await loadPreviousSnapshot();
  const previousCards = previous.cards;
  const previousMeta = previous.metadata;
  const previousMap = new Map(previousCards.map(card => [Number(card.id), card]));

  const allDetails = {};
  const allRelations = {};
  const dictionaries = { tribeNames: {}, setNames: {}, skillNames: {}, skillReplaceTextNames: {} };
  let offset = 0;
  let emptyPages = 0;

  while (emptyPages < 2) {
    console.log(`Fetching official cards at offset ${offset}...`);
    const json = await fetchPage(offset);
    const data = json?.data ?? {};
    const details = data.card_details ?? {};
    Object.assign(allDetails, details);
    Object.assign(allRelations, data.cards ?? {});
    Object.assign(dictionaries.tribeNames, data.tribe_names ?? {});
    Object.assign(dictionaries.setNames, data.card_set_names ?? {});
    Object.assign(dictionaries.skillNames, data.skill_names ?? {});
    Object.assign(dictionaries.skillReplaceTextNames, data.skill_replace_text_names ?? {});

    const count = Object.keys(details).length;
    emptyPages = count === 0 ? emptyPages + 1 : 0;
    offset += 30;
    if (offset > 3000) throw new Error("Pagination exceeded safety limit (3000)");
  }

  const cards = Object.entries(allDetails)
    .map(([id, detail]) => normalizeCard(id, detail, allRelations[id], dictionaries))
    .filter(card => card.name)
    .sort(compareGameCardOrderAllClasses);

  if (cards.length < 100) throw new Error(`Suspiciously small official card database: ${cards.length}`);

  const currentMap = new Map(cards.map(card => [card.id, card]));
  const hasBaseline = previousMap.size > 0;
  const added = [];
  const modified = [];
  const removed = [];

  for (const card of cards) {
    const old = previousMap.get(card.id);
    const changes = old ? compareCard(old, card) : [];
    card.newlyAdded = Boolean(hasBaseline && !old);
    card.modifiedInLatestUpdate = Boolean(hasBaseline && old && changes.length);
    if (card.newlyAdded) added.push(summary(card));
    if (card.modifiedInLatestUpdate) modified.push({ ...summary(card), changes });
  }

  if (hasBaseline) {
    for (const old of previousCards) {
      if (!currentMap.has(Number(old.id))) removed.push(summary(old));
    }
  }

  const generatedAt = new Date().toISOString();
  const changelog = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    previousGeneratedAt: previousMeta.generatedAt ?? null,
    baselineAvailable: hasBaseline,
    counts: { added: added.length, modified: modified.length, removed: removed.length },
    added,
    modified,
    removed
  };

  const deckSelectableCount = cards.filter(card => !card.token && card.setId !== 90000 && Number(card.maxCopies ?? 3) > 0).length;
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: SOURCE_API,
    imageBase: IMAGE_BASE,
    count: cards.length,
    deckSelectableCount,
    classes: Object.values(CLASS_NAMES),
    sets: dictionaries.setNames,
    traits: dictionaries.tribeNames,
    keywords: dictionaries.skillNames,
    skillReplaceTextNames: dictionaries.skillReplaceTextNames,
    update: changelog.counts
  };

  const classFiles = {};
  for (const className of Object.values(CLASS_NAMES)) {
    const fileName = `${slug(className)}.json`;
    classFiles[className] = `classes/${fileName}`;
    await writeJson(path.join(CLASS_DIR, fileName), cards.filter(card => card.class === className));
  }

  const manifest = {
    project: "Beyond Codex",
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: SOURCE_API,
    counts: {
      cards: cards.length,
      deckSelectable: deckSelectableCount,
      tokensOrGenerated: cards.length - deckSelectableCount
    },
    endpoints: {
      cards: "cards.json",
      metadata: "metadata.json",
      changelog: "changelog.json",
      classes: classFiles
    }
  };

  await Promise.all([
    writeJson(CARDS_PATH, cards),
    writeJson(META_PATH, metadata),
    writeJson(CHANGELOG_PATH, changelog),
    writeJson(MANIFEST_PATH, manifest)
  ]);

  console.log(`Beyond Codex updated: ${cards.length} cards · +${added.length} new · ~${modified.length} modified · -${removed.length} removed`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
