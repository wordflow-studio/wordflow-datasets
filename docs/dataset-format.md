# Dataset Format

Milestone 2 keeps the dataset contract intentionally small. Each dataset lives in `datasets/<slug>/` and must contain:

```text
datasets/<slug>/
├── assets/
│   ├── manifest.json
│   └── <local files>
├── content/
│   └── <item-slug>/
│       ├── body.html | body.md
│       └── entry.json
├── dataset.json
├── README.md
├── site.json
├── sources.json
└── taxonomies.json
```

## Core files

- `dataset.json`: dataset metadata, default locale, and supported targets.
- `site.json`: site-level title, description, and canonical URL.
- `sources.json`: provenance records for copy, assets, or imported fixtures.
- `taxonomies.json`: category and tag definitions, including optional parent terms.
- `assets/manifest.json`: asset records for local files in `assets/`.
- `content/<slug>/entry.json`: item metadata for a page or article.
- `content/<slug>/body.md` or `body.html`: item body content.

## Content item fields

- `bodyFormat`: `markdown` or `html`
- `id`: stable dataset-local identifier
- `kind`: `page` or `article`
- `locale`: locale code such as `en-US`
- `slug`: canonical content slug
- `sourceIds`: provenance references from `sources.json`
- `title`: display title
- `featuredAssetId`: optional asset reference
- `parentId`: optional content relationship, typically for pages
- `taxonomySlugs`: optional category/tag slugs
- `targets.wordpress`: optional WordPress-only extension fields such as `status`

Markdown bodies may include inline asset placeholders in the form `{{asset:asset-id}}`. During apply, placeholders are replaced with uploaded WordPress media URLs.

## Validation

The built-in validator checks:

- unique ids and slugs
- existing asset files
- known source references
- known taxonomy references
- parent content references
- inline asset placeholders

## Apply flow

`wordflow-dataset apply <dataset>` requires:

- `WORDPRESS_ENDPOINT`
- `WORDPRESS_PASSWORD`
- `WORDPRESS_USERNAME`

`WORDPRESS_PASSWORD` is the Basic Auth password paired with `WORDPRESS_USERNAME`. That can be an application password or any other password accepted by the target WordPress REST setup.

Authenticated requests require HTTPS unless `WORDPRESS_ENDPOINT` uses `localhost`, `127.0.0.1`, or `::1`.

The current apply path is intentionally thin. It upserts terms, uploads media, and upserts pages/articles through the WordPress REST API.
