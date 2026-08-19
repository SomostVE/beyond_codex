# Initial migration

Beyond Codex was split from Beyond Decks in August 2026.

For the first generated snapshot only, `scripts/update-cards.mjs` uses the embedded Beyond Decks `data/official/cards.json` and `metadata.json` as its comparison baseline before fetching the current official Deck Portal data. Subsequent updates compare against the previous Codex snapshot in `api/v1`.

This preserves continuity for `newlyAdded`, `modifiedInLatestUpdate`, metadata timestamps and the weekly changelog while moving ownership of official card acquisition out of the application repository.
