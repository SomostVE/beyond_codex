import assert from "node:assert/strict";
import { mergeAppendOnlyCards, mergeAppendOnlyDictionary } from "./append-only-merge.mjs";

const previous = [
  { id: 1, name: "Old A", cost: 1 },
  { id: 2, name: "Old B", cost: 2 },
  { id: 3, name: "Old C", cost: 3 }
];
const source = [
  { id: 1, name: "Updated A", cost: 2 },
  { id: 4, name: "New D", cost: 4 }
];

const merged = mergeAppendOnlyCards(previous, source);
assert.deepEqual(merged.cards.map(card => Number(card.id)), [1, 4, 2, 3]);
assert.equal(merged.cards.find(card => Number(card.id) === 1)?.name, "Updated A", "source must replace an existing ID");
assert.equal(merged.cards.find(card => Number(card.id) === 4)?.name, "New D", "new source IDs must be added");
assert.equal(merged.cards.find(card => Number(card.id) === 2)?.name, "Old B", "missing source IDs must be retained");
assert.deepEqual(merged.retainedMissingFromSource.map(card => Number(card.id)), [2, 3]);

assert.deepEqual(
  mergeAppendOnlyDictionary({ "10001": "Old Set", "10002": "Keep Me" }, { "10001": "Renamed Set", "10003": "New Set" }),
  { "10001": "Renamed Set", "10002": "Keep Me", "10003": "New Set" }
);

console.log("Append-only Beyond Codex sync policy: OK");
