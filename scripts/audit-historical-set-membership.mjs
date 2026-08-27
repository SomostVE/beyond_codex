import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const current = JSON.parse(await fs.readFile(path.join(ROOT, "api/v1/cards.json"), "utf8"));
const beyondDecks = process.argv[2] ? path.resolve(process.argv[2]) : null;

function git(args, cwd) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function snapshots(repo, file, label) {
  let commits = [];
  try {
    commits = git(["log", "--all", "--format=%H", "--", file], repo).split(/\r?\n/).filter(Boolean);
  } catch {}
  const rows = [];
  for (const sha of commits) {
    try {
      const cards = JSON.parse(git(["show", `${sha}:${file}`], repo));
      if (Array.isArray(cards)) rows.push({ label, sha, cards });
    } catch {}
  }
  return rows;
}

function selectable(card) {
  return !Boolean(card?.token) && Number(card?.setId) !== 90000 && card?.set !== "Token" && Number(card?.maxCopies ?? 3) > 0;
}

function counts(cards) {
  const map = new Map();
  for (const card of cards) {
    if (!selectable(card)) continue;
    const set = String(card.set ?? card.setId ?? "Unknown");
    map.set(set, (map.get(set) ?? 0) + 1);
  }
  return map;
}

const history = [
  ...snapshots(ROOT, "api/v1/cards.json", "beyond_codex"),
  ...(beyondDecks ? snapshots(beyondDecks, "data/official/cards.json", "beyond_decks") : [])
];

const currentById = new Map(current.map(card => [Number(card.id), card]));
const currentCounts = counts(current);
const maxBySet = new Map();

for (const snapshot of history) {
  for (const [set, count] of counts(snapshot.cards)) {
    const previous = maxBySet.get(set);
    if (!previous || count > previous.count) maxBySet.set(set, { count, label: snapshot.label, sha: snapshot.sha });
  }
}

console.log("=== CURRENT SET COUNTS ===");
for (const [set, count] of [...currentCounts].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`SET|${set}|${count}`);

console.log("=== HISTORICAL SET REGRESSIONS ===");
let setRegressionCount = 0;
for (const [set, peak] of [...maxBySet].sort((a, b) => a[0].localeCompare(b[0]))) {
  const now = currentCounts.get(set) ?? 0;
  if (now >= peak.count) continue;
  setRegressionCount += 1;
  console.log(`SET_REGRESSION|${set}|current=${now}|historicalMax=${peak.count}|${peak.label}:${peak.sha.slice(0, 12)}`);
}

const seenSelectability = new Map();
const seenSets = new Map();
for (const snapshot of history) {
  for (const card of snapshot.cards) {
    const id = Number(card.id);
    if (!currentById.has(id)) continue;
    if (selectable(card) && !seenSelectability.has(id)) seenSelectability.set(id, { card, snapshot });
    const setKey = `${Number(card.setId ?? 0)}|${String(card.set ?? "")}`;
    if (!seenSets.has(id)) seenSets.set(id, new Map());
    if (!seenSets.get(id).has(setKey)) seenSets.get(id).set(setKey, { card, snapshot });
  }
}

console.log("=== SELECTABILITY REGRESSIONS ===");
let selectabilityRegressionCount = 0;
for (const [id, historical] of seenSelectability) {
  const now = currentById.get(id);
  if (selectable(now)) continue;
  selectabilityRegressionCount += 1;
  console.log(`SELECTABILITY_REGRESSION|${id}|${now.name}|current token=${Boolean(now.token)} maxCopies=${now.maxCopies} set=${now.set}|was selectable in ${historical.snapshot.label}:${historical.snapshot.sha.slice(0, 12)}`);
}

console.log("=== SET MEMBERSHIP CHANGES ===");
let setChangeCount = 0;
for (const [id, variants] of seenSets) {
  const now = currentById.get(id);
  const currentKey = `${Number(now.setId ?? 0)}|${String(now.set ?? "")}`;
  for (const [key, historical] of variants) {
    if (key === currentKey) continue;
    setChangeCount += 1;
    console.log(`SET_CHANGE|${id}|${now.name}|current=${currentKey}|historical=${key}|${historical.snapshot.label}:${historical.snapshot.sha.slice(0, 12)}`);
  }
}

console.log(`SUMMARY|setsWithLowerCount=${setRegressionCount}|selectabilityRegressions=${selectabilityRegressionCount}|setMembershipChanges=${setChangeCount}`);
