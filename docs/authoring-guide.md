# Authoring guide

Use this guide to create a v1 dataset that passes `wordflow-dataset validate`.

## 1. Create the folder layout

Start with this structure:

```text
datasets/<slug>/
├── README.md
├── assets/
├── content/
├── dataset.json
├── sources.json
└── taxonomies.json
```

Git does not track empty directories, so keep `assets/` with a `.gitkeep` file until you add real files.

## 2. Add the dataset manifest

Create `dataset.json` with:

- `description`
- `locale`
- `schemaVersion`
- `slug`
- `title`

Use `schemaVersion: "1.0.0"` for v1 datasets.

## 3. Define provenance first

Create `sources.json` before you author content. Every content item should cite the source ids that produced its copy or assets.

Use one source entry per unique origin. Source ids must stay stable because content items reference them through `sourceRefs`.

## 4. Define taxonomy vocabulary

Create `taxonomies.json` with the taxonomies and term slugs that content items may reference.

Use `taxonomyRefs` in `item.json` with the format `<taxonomy-slug>:<term-slug>`.

## 5. Author content items

Each content item lives in `content/<type>/<slug>/` and must contain:

- `body.md`
- `item.json`

`item.json` uses these required fields:

- `locale`
- `slug`
- `sourceRefs`
- `state`
- `taxonomyRefs`
- `title`
- `type`

Optional fields:

- `excerpt`
- `featuredAsset`

The folder name and `item.json.slug` must match.

## 6. Validate before committing

Run:

```bash
bun run ./src/cli.ts validate datasets/<slug>
```

The validator checks:

- duplicate slugs within the same content type and locale
- missing `body.md` files
- missing required top-level files or directories
- missing referenced featured assets
- unresolved `sourceRefs`
- unresolved `taxonomyRefs`
