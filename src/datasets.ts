import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  DatasetAssetsFile,
  DatasetContentItem,
  DatasetManifest,
  DatasetSite,
  DatasetSourcesFile,
  DatasetSummary,
  DatasetTaxonomiesFile,
  LoadedAsset,
  LoadedContentItem,
  LoadedDataset,
  ValidationError,
  ValidationResult,
} from './contracts.ts'
import { collectAssetPlaceholderIds } from './markdown.ts'

const packagedDatasetsDir = fileURLToPath(new URL('../datasets', import.meta.url))

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const file = await readFile(path, 'utf8')
  return JSON.parse(file) as T
}

export async function resolveDatasetDirectory(input: string): Promise<string> {
  const candidates = [
    resolve(input),
    resolve(process.cwd(), input),
    resolve(process.cwd(), 'datasets', input),
    resolve(packagedDatasetsDir, input),
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(`Dataset not found: ${input}`)
}

export async function loadDataset(input: string): Promise<LoadedDataset> {
  const rootDir = await resolveDatasetDirectory(input)
  const assetsDir = join(rootDir, 'assets')
  const contentDir = join(rootDir, 'content')

  const assetsFile = await readJsonFile<DatasetAssetsFile>(join(assetsDir, 'manifest.json'))
  const manifest = await readJsonFile<DatasetManifest>(join(rootDir, 'dataset.json'))
  const site = await readJsonFile<DatasetSite>(join(rootDir, 'site.json'))
  const sourcesFile = await readJsonFile<DatasetSourcesFile>(join(rootDir, 'sources.json'))
  const taxonomiesFile = await readJsonFile<DatasetTaxonomiesFile>(join(rootDir, 'taxonomies.json'))

  const assets: LoadedAsset[] = assetsFile.assets.map((asset) => ({
    ...asset,
    filePath: join(assetsDir, asset.filename),
  }))

  const contentEntries = await readdir(contentDir, { withFileTypes: true })
  const contentDirectories = contentEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const contentItems = await Promise.all(
    contentDirectories.map(async (directoryName): Promise<LoadedContentItem> => {
      const entryPath = join(contentDir, directoryName, 'entry.json')
      const entry = await readJsonFile<DatasetContentItem>(entryPath)
      const extension = entry.bodyFormat === 'html' ? 'html' : 'md'
      const bodyPath = join(contentDir, directoryName, `body.${extension}`)
      const body = await readFile(bodyPath, 'utf8')

      return {
        ...entry,
        body,
        bodyPath,
      }
    }),
  )

  return {
    assets,
    contentItems,
    manifest,
    rootDir,
    site,
    sources: sourcesFile.sources,
    terms: taxonomiesFile.terms,
  }
}

export function summarizeDataset(dataset: LoadedDataset): DatasetSummary {
  const articleCount = dataset.contentItems.filter((item) => item.kind === 'article').length
  const pageCount = dataset.contentItems.filter((item) => item.kind === 'page').length

  return {
    articleCount,
    assetCount: dataset.assets.length,
    pageCount,
    sourceCount: dataset.sources.length,
    termCount: dataset.terms.length,
  }
}

export async function validateDatasetInput(input: string): Promise<ValidationResult> {
  const dataset = await loadDataset(input)
  return validateDataset(dataset)
}

export function validateDataset(dataset: LoadedDataset): ValidationResult {
  const errors: ValidationError[] = []
  const assetIds = new Set<string>()
  const contentIds = new Set<string>()
  const contentSlugs = new Set<string>()
  const sourceIds = new Set<string>()
  const termKeys = new Set<string>()

  const pushError = (path: string, message: string) => {
    errors.push({ message, path })
  }

  if (dataset.manifest.id !== dataset.rootDir.split('/').pop()) {
    pushError('dataset.json.id', 'Dataset id must match the directory name.')
  }

  if (!dataset.manifest.targets.includes('wordpress')) {
    pushError('dataset.json.targets', 'At least the `wordpress` target must be declared.')
  }

  for (const source of dataset.sources) {
    if (sourceIds.has(source.id)) {
      pushError(`sources.json#${source.id}`, 'Source ids must be unique.')
    }

    sourceIds.add(source.id)
  }

  for (const term of dataset.terms) {
    const key = `${term.taxonomy}:${term.slug}`
    if (termKeys.has(key)) {
      pushError(`taxonomies.json#${key}`, 'Term slugs must be unique within each taxonomy.')
    }

    termKeys.add(key)
  }

  for (const term of dataset.terms) {
    if (!term.parentSlug) {
      continue
    }

    const parentKey = `${term.taxonomy}:${term.parentSlug}`
    if (!termKeys.has(parentKey)) {
      pushError(`taxonomies.json#${term.taxonomy}:${term.slug}`, 'Parent term slug must reference an existing term.')
    }
  }

  for (const asset of dataset.assets) {
    if (assetIds.has(asset.id)) {
      pushError(`assets/manifest.json#${asset.id}`, 'Asset ids must be unique.')
    }

    assetIds.add(asset.id)

    for (const sourceId of asset.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        pushError(`assets/manifest.json#${asset.id}`, `Unknown source id: ${sourceId}`)
      }
    }
  }

  for (const item of dataset.contentItems) {
    if (contentIds.has(item.id)) {
      pushError(`content/${item.id}/entry.json`, 'Content ids must be unique.')
    }

    if (contentSlugs.has(item.slug)) {
      pushError(`content/${item.id}/entry.json`, 'Content slugs must be unique across the dataset.')
    }

    contentIds.add(item.id)
    contentSlugs.add(item.slug)

    if (item.featuredAssetId && !assetIds.has(item.featuredAssetId)) {
      pushError(`content/${item.id}/entry.json`, `Unknown featuredAssetId: ${item.featuredAssetId}`)
    }

    if (
      item.parentId &&
      !contentIds.has(item.parentId) &&
      !dataset.contentItems.some((candidate) => candidate.id === item.parentId)
    ) {
      pushError(`content/${item.id}/entry.json`, `Unknown parentId: ${item.parentId}`)
    }

    for (const sourceId of item.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        pushError(`content/${item.id}/entry.json`, `Unknown source id: ${sourceId}`)
      }
    }

    for (const taxonomy of ['category', 'tag'] as const) {
      const slugs = item.taxonomySlugs?.[taxonomy] ?? []
      for (const slug of slugs) {
        const key = `${taxonomy}:${slug}`
        if (!termKeys.has(key)) {
          pushError(`content/${item.id}/entry.json`, `Unknown ${taxonomy} slug: ${slug}`)
        }
      }
    }

    for (const assetId of collectAssetPlaceholderIds(item.body)) {
      if (!assetIds.has(assetId)) {
        pushError(`content/${item.id}/${item.bodyPath.split('/').pop()}`, `Unknown inline asset id: ${assetId}`)
      }
    }
  }

  errors.sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path)
    if (pathComparison !== 0) {
      return pathComparison
    }

    return left.message.localeCompare(right.message)
  })

  return {
    errors,
    valid: errors.length === 0,
  }
}
