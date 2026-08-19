import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "api", "v1");

const cards = JSON.parse(await fs.readFile(path.join(API_DIR, "cards.json"), "utf8"));
const metadata = JSON.parse(await fs.readFile(path.join(API_DIR, "metadata.json"), "utf8"));
const changelog = JSON.parse(await fs.readFile(path.join(API_DIR, "changelog.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(API_DIR, "manifest.json"), "utf8"));

if (!Array.isArray(cards) || cards.length < 100) throw new Error("cards.json is missing or suspiciously small");
if (metadata.schemaVersion !== 1 || manifest.schemaVersion !== 1 || changelog.schemaVersion !== 1) throw new Error("Beyond Codex schemaVersion must be 1");
if (metadata.count !== cards.length || manifest.counts?.cards !== cards.length) throw new Error("Card counts disagree between API files");

const ids = new Set();
const expectedClasses = ["Neutral", "Forestcraft", "Swordcraft", "Runecraft", "Dragoncraft", "Abysscraft", "Havencraft", "Portalcraft"];
const validTypes = new Set(["Follower", "Spell", "Amulet"]);
const validRarities = new Set(["Bronze", "Silver", "Gold", "Legendary"]);

for (const card of cards) {
  if (!Number.isFinite(Number(card.id))) throw new Error(`Invalid card id: ${card.id}`);
  if (ids.has(Number(card.id))) throw new Error(`Duplicate card id: ${card.id}`);
  ids.add(Number(card.id));
  if (!card.name) throw new Error(`Card ${card.id} has no name`);
  if (!expectedClasses.includes(card.class)) throw new Error(`${card.name}: invalid class ${card.class}`);
  if (!validTypes.has(card.type)) throw new Error(`${card.name}: invalid type ${card.type}`);
  if (!validRarities.has(card.rarity)) throw new Error(`${card.name}: invalid rarity ${card.rarity}`);
  if (!Array.isArray(card.traits) || !Array.isArray(card.keywords) || !Array.isArray(card.relatedCards)) throw new Error(`${card.name}: array fields are invalid`);
  if (typeof card.text !== "string" || typeof card.rawSkillText !== "string") throw new Error(`${card.name}: skill text fields are invalid`);
  if (!Array.isArray(card.styles) || !Array.isArray(card.questions)) throw new Error(`${card.name}: style/question fields are invalid`);
}

for (const className of expectedClasses) {
  const relative = manifest.endpoints?.classes?.[className];
  if (!relative) throw new Error(`Manifest has no endpoint for ${className}`);
  const subset = JSON.parse(await fs.readFile(path.join(API_DIR, relative), "utf8"));
  const expected = cards.filter(card => card.class === className);
  if (subset.length !== expected.length) throw new Error(`${className}: class subset count mismatch (${subset.length} vs ${expected.length})`);
  if (!subset.every(card => card.class === className)) throw new Error(`${className}: class subset contains another class`);
}

if (!changelog.counts || !Array.isArray(changelog.added) || !Array.isArray(changelog.modified) || !Array.isArray(changelog.removed)) {
  throw new Error("changelog.json structure is invalid");
}

const deckSelectable = cards.filter(card => !card.token && Number(card.setId) !== 90000 && Number(card.maxCopies ?? 3) > 0).length;
if (metadata.deckSelectableCount !== deckSelectable || manifest.counts?.deckSelectable !== deckSelectable) {
  throw new Error("Deck-selectable count mismatch");
}

console.log(`Beyond Codex validation OK: ${cards.length} cards · ${deckSelectable} deck-selectable · ${cards.length - deckSelectable} tokens/generated`);
