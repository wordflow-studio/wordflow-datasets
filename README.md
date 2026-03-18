# wordflow-dataset

`wordflow-dataset` defines and validates portable content datasets for Wordflow seeding workflows.

The repository now contains the first portable dataset contract, validation tooling, sample content for repeatable seeding workflows, and a narrow WordPress Playground smoke harness that proves portable datasets can be applied to fresh WordPress installs. The public WordPress apply CLI is still intentionally deferred so the canonical dataset model stays portable.

## What ships in v1

- a documented dataset contract
- fixture datasets in [`datasets/editorial-sample`](./datasets/editorial-sample) and [`datasets/theme-unit-test`](./datasets/theme-unit-test)
- a portable validation library via `validateDataset(path)`
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

Run the internal WordPress apply smoke harness:

```bash
bun run wp:smoke:editorial-sample
bun run wp:smoke:theme-unit-test
```

These smoke commands use the WordPress Playground CLI and download a fresh WordPress runtime the first time they run.

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
