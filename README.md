# Beyond Codex

Structured Shadowverse: Worlds Beyond card data for Beyond Decks and other tools.

Beyond Codex snapshots and normalizes the official English card database, publishes stable JSON endpoints, and tracks changes between weekly snapshots. Downstream applications consume Codex instead of repeatedly querying the official Deck Portal.

## Source

Official Shadowverse: Worlds Beyond Deck Portal endpoint:

`https://shadowverse-wb.com/web/CardList/cardList`

## API v1

Published from the `main` branch:

- `api/v1/cards.json` — complete normalized database, including tokens/generated cards
- `api/v1/metadata.json` — sets, traits, keywords and generation metadata
- `api/v1/changelog.json` — added, modified and removed cards since the previous snapshot
- `api/v1/manifest.json` — schema/version information and endpoint list
- `api/v1/classes/*.json` — per-class subsets

Raw GitHub base URL:

`https://raw.githubusercontent.com/SomostVE/beyond_codex/main/api/v1/`

GitHub Pages base URL:

`https://somostve.github.io/beyond_codex/api/v1/`

## Updates

GitHub Actions refreshes the dataset every Monday at 04:20 UTC. A manual `workflow_dispatch` is also available for releases or emergency refreshes.

Every refresh is normalized and validated before publication. The updater rejects suspiciously incomplete snapshots, including abnormal total-card shrinkage, large per-class drops and excessive removals. This prevents a partial response from the official service from replacing a healthy Codex snapshot.

Keyword extraction also normalizes fragmented official markup such as `Invoke` + `d` into the intended `Invoked` token instead of exposing markup fragments as standalone keywords.

Pull requests run acquisition and validation but never commit generated API files. Snapshot commits are only produced by trusted branch runs such as `main`, the weekly schedule or a manual dispatch.

The first Codex refresh seeds its comparison baseline from the last embedded Beyond Decks snapshot, so migration does not discard the existing card database history. See `MIGRATION.md` for the initialization boundary.

## Ownership boundary

**Beyond Codex owns:**

- official card acquisition
- normalization
- official card text / raw skill text
- images and image hashes
- evolved/style data
- sets, traits and keyword dictionaries
- weekly card-data changelog
- snapshot completeness and schema validation

**Beyond Decks owns:**

- deck builder UI
- Collection / Deck Lab / Engines
- custom packages and tags
- reference decks
- Battle Sim engine and AI
- user-local workspace data

Consumer: [Beyond Decks](https://github.com/SomostVE/beyond_decks)
