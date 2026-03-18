import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  WordPressContentInput,
  WordPressContentRecord,
  WordPressMediaInput,
  WordPressMediaRecord,
  WordPressTermInput,
  WordPressTermRecord,
  WordPressTransport,
} from '../src/contracts.ts'
import { applyDatasetToWordPress, loadDataset, summarizeDataset, validateDataset } from '../src/index.ts'

class InMemoryWordPressTransport implements WordPressTransport {
  private nextId = 1

  private readonly content = new Map<string, WordPressContentRecord & WordPressContentInput>()

  private readonly media = new Map<string, WordPressMediaRecord & WordPressMediaInput>()

  private readonly terms = new Map<string, WordPressTermRecord>()

  async upsertContent(input: WordPressContentInput): Promise<WordPressContentRecord> {
    const key = `${input.kind}:${input.slug}`
    const existing = this.content.get(key)
    const id = existing?.id ?? this.nextId++
    const record = {
      ...input,
      id,
    }

    this.content.set(key, record)

    return {
      id,
      kind: input.kind,
      slug: input.slug,
      title: input.title,
    }
  }

  async upsertMedia(input: WordPressMediaInput): Promise<WordPressMediaRecord> {
    const existing = this.media.get(input.slug)
    const id = existing?.id ?? this.nextId++
    const record = {
      ...input,
      id,
      sourceUrl: `https://example.test/wp-content/uploads/${input.filename}`,
    }

    this.media.set(input.slug, record)

    return {
      altText: input.altText,
      id,
      slug: input.slug,
      sourceUrl: record.sourceUrl,
      title: input.title,
    }
  }

  async upsertTerm(input: WordPressTermInput): Promise<WordPressTermRecord> {
    const key = `${input.taxonomy}:${input.slug}`
    const existing = this.terms.get(key)
    const record = {
      ...input,
      id: existing?.id ?? this.nextId++,
    }

    this.terms.set(key, record)
    return record
  }

  snapshot() {
    return {
      content: [...this.content.values()]
        .map(
          ({
            bodyHtml,
            excerpt,
            featuredMediaId,
            id,
            kind,
            parentId,
            slug,
            status,
            sticky,
            taxonomyTermIds,
            template,
            title,
          }) => ({
            bodyHtml,
            excerpt,
            featuredMediaId,
            id,
            kind,
            parentId,
            slug,
            status,
            sticky,
            taxonomyTermIds,
            template,
            title,
          }),
        )
        .sort((left, right) => `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`)),
      media: [...this.media.values()]
        .map(({ altText, filename, id, slug, sourceUrl, title }) => ({
          altText,
          filename,
          id,
          slug,
          sourceUrl,
          title,
        }))
        .sort((left, right) => left.slug.localeCompare(right.slug)),
      terms: [...this.terms.values()]
        .map(({ description, id, name, slug, taxonomy }) => ({
          description,
          id,
          name,
          slug,
          taxonomy,
        }))
        .sort((left, right) => `${left.taxonomy}:${left.slug}`.localeCompare(`${right.taxonomy}:${right.slug}`)),
    }
  }
}

test('editorial sample loads with the expected summary', async () => {
  const dataset = await loadDataset('editorial-sample')
  expect(summarizeDataset(dataset)).toEqual({
    articleCount: 2,
    assetCount: 1,
    pageCount: 2,
    sourceCount: 2,
    termCount: 5,
  })
})

test('shipped datasets validate successfully', async () => {
  const editorialSample = await loadDataset('editorial-sample')
  const themeUnitTest = await loadDataset('theme-unit-test')

  expect(validateDataset(editorialSample)).toEqual({
    errors: [],
    valid: true,
  })
  expect(validateDataset(themeUnitTest)).toEqual({
    errors: [],
    valid: true,
  })
})

test('validation reports broken references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wordflow-dataset-'))
  const datasetDir = join(root, 'broken-dataset')
  const contentDir = join(datasetDir, 'content', 'broken-page')

  await mkdir(join(datasetDir, 'assets'), { recursive: true })
  await mkdir(contentDir, { recursive: true })

  await writeFile(
    join(datasetDir, 'assets', 'manifest.json'),
    JSON.stringify(
      {
        assets: [],
      },
      null,
      2,
    ),
  )
  await writeFile(join(datasetDir, 'content', 'broken-page', 'body.md'), '# Broken page\n\n{{asset:missing-asset}}\n')
  await writeFile(
    join(datasetDir, 'content', 'broken-page', 'entry.json'),
    JSON.stringify(
      {
        bodyFormat: 'markdown',
        featuredAssetId: 'missing-asset',
        id: 'broken-page',
        kind: 'page',
        locale: 'en-US',
        slug: 'broken-page',
        sourceIds: ['missing-source'],
        targets: {
          wordpress: {
            status: 'publish',
          },
        },
        title: 'Broken page',
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(datasetDir, 'dataset.json'),
    JSON.stringify(
      {
        datasetVersion: '1.0.0',
        defaultLocale: 'en-US',
        description: 'Broken dataset fixture',
        id: 'broken-dataset',
        label: 'Broken Dataset',
        targets: ['wordpress'],
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(datasetDir, 'site.json'),
    JSON.stringify(
      {
        description: 'Broken site',
        title: 'Broken site',
        url: 'https://example.test/broken-site',
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(datasetDir, 'sources.json'),
    JSON.stringify(
      {
        sources: [],
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(datasetDir, 'taxonomies.json'),
    JSON.stringify(
      {
        terms: [],
      },
      null,
      2,
    ),
  )

  const dataset = await loadDataset(datasetDir)
  const validation = validateDataset(dataset)

  expect(validation.valid).toBe(false)
  expect(validation.errors).toEqual([
    {
      message: 'Unknown inline asset id: missing-asset',
      path: 'content/broken-page/body.md',
    },
    {
      message: 'Unknown featuredAssetId: missing-asset',
      path: 'content/broken-page/entry.json',
    },
    {
      message: 'Unknown source id: missing-source',
      path: 'content/broken-page/entry.json',
    },
  ])
})

for (const datasetName of ['editorial-sample', 'theme-unit-test']) {
  test(`applying ${datasetName} twice is idempotent`, async () => {
    const dataset = await loadDataset(datasetName)
    const transport = new InMemoryWordPressTransport()

    const firstResult = await applyDatasetToWordPress(dataset, transport)
    const firstSnapshot = transport.snapshot()
    const secondResult = await applyDatasetToWordPress(dataset, transport)
    const secondSnapshot = transport.snapshot()

    expect(firstResult.content).toHaveLength(dataset.contentItems.length)
    expect(secondResult.content).toHaveLength(dataset.contentItems.length)
    expect(secondSnapshot).toEqual(firstSnapshot)
  })
}
