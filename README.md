# wordflow-dataset

`wordflow-dataset` is a Bun package and CLI for repeatable dataset validation and WordPress seeding.

Milestone 2 in this repo now includes:

- a first curated dataset: `editorial-sample`
- a pinned upstream-derived fixture subset: `theme-unit-test`
- a dataset contract with validation
- a thin WordPress apply path for repeatable seeding

## Development

Install dependencies with Bun:

```bash
bun install
```

Common commands:

- `bun run build`
- `bun run check-types`
- `bun run lint`
- `bun run lint:fix`
- `bun test`
- `bun run test:watch`

## CLI

Validate a dataset:

```bash
bun run src/cli.ts validate editorial-sample
```

Apply a dataset to WordPress:

```bash
bun wp-playground

cp .env.example .env

bun run src/cli.ts apply editorial-sample
```

Bun loads `.env` automatically. If Playground prints a different local URL, update `WORDPRESS_ENDPOINT` in `.env`.

The bundled Playground scripts mount a local mu-plugin that enables development-only REST Basic Auth with the default Playground `admin` / `password` credentials. For non-local WordPress targets, use normal WordPress REST credentials, which often means an application password.

If you want the browser session auto-logged-in for manual inspection, use `bun wp-playground-login` instead. For REST API testing, use `bun wp-playground`; `--login` can interfere with API clients by redirecting authenticated REST requests.

Authenticated requests require HTTPS unless `WORDPRESS_ENDPOINT` uses `localhost`, `127.0.0.1`, or `::1`.

## Datasets

- `datasets/editorial-sample`: curated editorial sample with a local asset, pages, posts, taxonomy, and provenance.
- `datasets/theme-unit-test`: reduced subset derived from the upstream WordPress Theme Test Data project.

The contract is documented in [docs/dataset-format.md](./docs/dataset-format.md).

## Releases

This repo uses Changesets for versioning and npm publishing.

1. Add a changeset with `bun run changeset`.
2. Version the package with `bun run version`.
3. Publish with `bun run release`.
