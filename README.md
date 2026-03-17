# wordflow-dataset

`wordflow-dataset` is the package and CLI scaffold for the `wordflow-studio/wordflow-datasets` repo.

The repository is intended to hold tooling and datasets for repeatable WordPress site generation and seeding. Current status: early scaffold. The package metadata, build tooling, tests, and release flow are in place, but the dataset and seeding feature set is still to be built out.

## Development

Install dependencies with Bun:

```bash
bun install
```

Common commands:

- `bun run build`
- `bun run lint`
- `bun run lint:fix`
- `bun run check-types`
- `bun test`
- `bun run test:watch`

## Releases

This repo uses Changesets for versioning and npm publishing.

1. Add a changeset with `bun run changeset`.
2. Version the package with `bun run version`.
3. Publish with `bun run release`.

## Status

This README intentionally describes the project as it exists today. `wordflow-dataset` is not yet a complete dataset generation or WordPress seeding tool; it is an honest starting point for that work.

## License

MIT. See [LICENSE](./LICENSE).
