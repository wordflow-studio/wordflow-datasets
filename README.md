# wordflow-dataset

`wordflow-dataset` defines and validates portable content datasets for Wordflow seeding workflows.

The repository now contains the first portable dataset contract, validation tooling, and sample content for repeatable seeding workflows. WordPress-specific apply logic is intentionally deferred so the canonical dataset model stays portable.

## What ships in v1

- a documented dataset contract
- a portable validation library via `validateDataset(path)`
- a sample curated dataset in [`datasets/editorial-sample`](./datasets/editorial-sample)
- a validating CLI via `wordflow-dataset validate <path>`

## Quick start

Install dependencies:

```bash
bun install
```

Validate the sample dataset:

```bash
bun run ./src/cli.ts validate datasets/editorial-sample
```

Run the local checks:

```bash
bun run build
bun run check-types
bun run lint
bun run test
```

## Dataset layout

```text
datasets/<slug>/
├── README.md
├── assets/
├── content/
│   ├── page/
│   │   └── <slug>/
│   │       ├── body.md
│   │       └── item.json
│   └── post/
│       └── <slug>/
│           ├── body.md
│           └── item.json
├── dataset.json
├── sources.json
└── taxonomies.json
```

## Documentation

- [Authoring guide](./docs/authoring-guide.md)
- [Dataset format](./docs/dataset-format.md)
- [Dataset schema](./schemas/dataset.schema.json)
- [Item schema](./schemas/item.schema.json)
- [Sources schema](./schemas/sources.schema.json)
- [Taxonomies schema](./schemas/taxonomies.schema.json)

## Releases

This repo uses Changesets for versioning and npm publishing.

1. Add a changeset with `bun run changeset`.
2. Version the package with `bun run version`.
3. Publish with `bun run release`.

## License

MIT. See [LICENSE](./LICENSE).
