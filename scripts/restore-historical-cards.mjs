import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareGameCardOrderAllClasses } from "./card-sort.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "api", "v1");
const CARDS_PATH = path.join(API_DIR, "cards.json");
const META_PATH = path.join(API_DIR, "metadata.json");
const CHANGELOG_PATH = path.join(API_DIR, "changelog.json");
const MANIFEST_PATH = path.join(API_DIR, "manifest.json");
const CLASS_DIR = path.join(API_DIR, "classes");
const BEYOND_DECKS_DIR = process.argv[2] ? path.resolve(process.argv[2]) : null;

const CLASS_NAMES = ["Neutral", "Forestcraft", "Swordcraft", "Runecraft", "Dragoncraft", "Abysscraft", "Havencraft", "Portalcraft"];
const CLASS_FILES = Object.fromEntries(CLASS_NAMES.map(name => [name, `classes/${name.toLowerCase().replace(/craft$/, "craft")}.json`]));

function git(args, cwd) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function commitsFor(repoDir, filePath) {
  try {
    return git(["log", "--all", "--format=%H", "--", filePath], repoDir)
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function cardsAt(repoDir, sha, filePath) {
  try {
    const raw = git(["show", `${sha}:${filePath}`], repoDir);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeCard(card) {
  return {
    ...card,
    id: Number(card.id),
    baseCardId: Number(card.baseCardId ?? card.id),
    traits: Array.isArray(card.traits) ? card.traits : [],
    keywords: Array.isArray(card.keywords) ? card.keywords : [],
    relatedCards: Array.isArray(card.relatedCards) ? card.relatedCards.map(Number) : [],
    styles: Array.isArray(card.styles) ? card.styles : [],
    questions: Array.isArray(card.questions) ? card.questions : [],
    newlyAdded: false,
    modifiedInLatestUpdate: false
  };
}

function summary(card, origin) {
  return {
    id: Number(card.id),
    name: card.name ?? "",
    class: card.class ?? "",
    set: card.set ?? "",
    rarity: card.rarity ?? "",
    origin
  };
}

function collectMissingFromHistory({ repoDir, filePath, currentIds, recovered, originPrefix }) {
  const commits = commitsFor(repoDir, filePath);
  console.log(`${originPrefix}: scanning ${commits.length} historical snapshots of ${filePath}`);
  for (const sha of commits) {
    for (const rawCard of cardsAt(repoDir, sha, filePath)) {
      const id = Number(rawCard?.id);
      if (!Number.isFinite(id) || currentIds.has(id) || recovered.has(id)) continue;
      const card = sanitizeCard(rawCard);
      recovered.set(id, { card, origin: `${originPrefix}:${sha.slice(0, 12)}` });
    }
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const currentCards = JSON.parse(await fs.readFile(CARDS_PATH, "utf8"));
const metadata = JSON.parse(await fs.readFile(META_PATH, "utf8"));
const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
const currentIds = new Set(currentCards.map(card => Number(card.id)));
const recovered = new Map();

collectMissingFromHistory({
  repoDir: ROOT,
  filePath: "api/v1/cards.json",
  currentIds,
  recovered,
  originPrefix: "beyond_codex"
});

if (BEYOND_DECKS_DIR) {
  collectMissingFromHistory({
    repoDir: BEYOND_DECKS_DIR,
    filePath: "data/official/cards.json",
    currentIds,
    recovered,
    originPrefix: "beyond_decks"
  });
}

const recoveredRows = [...recovered.values()]
  .sort((a, b) => Number(a.card.id) - Number(b.card.id));

console.log(`Historical cards missing from current Codex: ${recoveredRows.length}`);
for (const { card, origin } of recoveredRows) {
  console.log(`RESTORE|${card.id}|${card.class}|${card.set}|${card.name}|${origin}`);
}

if (!recoveredRows.length) process.exit(0);

const cards = [
  ...currentCards.map(sanitizeCard),
  ...recoveredRows.map(row => row.card)
].sort(compareGameCardOrderAllClasses);

const generatedAt = new Date().toISOString();
const sourceCount = Number(metadata.sourceCount ?? manifest.counts?.sourceCards ?? currentCards.length);
const retained = cards.length - sourceCount;
const restoredSummaries = recoveredRows.map(({ card, origin }) => summary(card, origin));

for (const { card } of recoveredRows) {
  if (card.setId != null && card.set) metadata.sets[String(card.setId)] ??= card.set;
}

const deckSelectableCount = cards.filter(card => !card.token && Number(card.setId) !== 90000 && Number(card.maxCopies ?? 3) > 0).length;

const changelog = {
  schemaVersion: 1,
  generatedAt,
  previousGeneratedAt: metadata.generatedAt ?? null,
  baselineAvailable: true,
  policy: "append-or-replace-never-delete",
  counts: {
    added: 0,
    modified: 0,
    removed: 0,
    retainedMissingFromSource: retained,
    restoredHistorical: restoredSummaries.length
  },
  added: [],
  modified: [],
  removed: [],
  retainedMissingFromSource: restoredSummaries,
  restoredHistorical: restoredSummaries
};

const nextMetadata = {
  ...metadata,
  generatedAt,
  count: cards.length,
  sourceCount,
  deckSelectableCount,
  update: changelog.counts
};

const nextManifest = {
  ...manifest,
  generatedAt,
  counts: {
    cards: cards.length,
    sourceCards: sourceCount,
    retainedMissingFromSource: retained,
    deckSelectable: deckSelectableCount,
    tokensOrGenerated: cards.length - deckSelectableCount
  }
};

for (const className of CLASS_NAMES) {
  const relative = nextManifest.endpoints?.classes?.[className] ?? CLASS_FILES[className];
  await writeJson(path.join(API_DIR, relative), cards.filter(card => card.class === className));
}

await Promise.all([
  writeJson(CARDS_PATH, cards),
  writeJson(META_PATH, nextMetadata),
  writeJson(CHANGELOG_PATH, changelog),
  writeJson(MANIFEST_PATH, nextManifest)
]);

console.log(`Restored ${restoredSummaries.length} historical cards: ${currentCards.length} -> ${cards.length}`);
