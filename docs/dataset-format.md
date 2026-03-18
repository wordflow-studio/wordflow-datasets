# Dataset format

This document defines the portable v1 dataset contract for `wordflow-dataset`.

## Design goals

- keep the canonical model generic enough for future non-WordPress targets
- keep provenance explicit through `sources.json`
- keep validation deterministic and filesystem-friendly
- keep authoring practical with colocated `body.md` and `item.json`

## Root layout

Each dataset must contain:

- `README.md`
- `assets/`
- `content/`
- `dataset.json`
- `sources.json`
- `taxonomies.json`

Recommended layout:

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

## `dataset.json`

Required fields:

- `description`: human summary of the dataset intent
- `locale`: primary locale for the dataset, using a BCP 47 style tag such as `en-US`
- `schemaVersion`: fixed to `1.0.0`
- `slug`: stable dataset identifier
- `title`: human-readable dataset name

## `sources.json`

Top-level shape:

```json
{
  "sources": []
}
```

Each source record supports:

- `author`
- `id`
- `kind`
- `license`
- `name`
- `originalUrl`

`id`, `kind`, `license`, and `name` are required. `id` must be unique within the dataset.

## `taxonomies.json`

Top-level shape:

```json
{
  "taxonomies": []
}
```

Each taxonomy definition supports:

- `label`
- `slug`
- `terms`
- `type`

Each term requires:

- `label`
- `slug`

Taxonomy refs use the format `<taxonomy-slug>:<term-slug>`.

## `content/<type>/<slug>/item.json`

Required fields:

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

Rules:

- `body.md` is required for every content item
- `body.md` may contain Markdown, raw HTML, or WordPress block markup as plain text
- `featuredAsset`, when present, must point to a file inside the dataset directory
- `sourceRefs` entries must exist in `sources.json`
- `taxonomyRefs` entries must exist in `taxonomies.json`
- duplicate `slug` values are allowed only when `locale` or `type` differs

## Validation scope in v1

`validateDataset(path)` and `wordflow-dataset validate <path>` check:

- directory structure
- JSON parse errors
- required fields and enums
- schema version support
- slug, locale, and URL formats
- reference resolution for assets, sources, and taxonomies

The public WordPress apply contract is intentionally out of scope for v1. This repo only includes a narrow internal WordPress smoke harness for repeatable apply checks.
