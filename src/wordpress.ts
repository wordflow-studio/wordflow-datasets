import { readFile } from 'node:fs/promises'

import type {
  ContentKind,
  LoadedAsset,
  LoadedContentItem,
  LoadedDataset,
  TaxonomyKind,
  WordPressApplyResult,
  WordPressConnectionOptions,
  WordPressContentInput,
  WordPressContentRecord,
  WordPressMediaInput,
  WordPressMediaRecord,
  WordPressTermInput,
  WordPressTermRecord,
  WordPressTransport,
} from './contracts.ts'
import { validateDataset } from './datasets.ts'
import { renderBodyToHtml } from './markdown.ts'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost'])
const WORDPRESS_REQUEST_TIMEOUT_MS = 10_000

type RawRestEntity = {
  id: number
  slug?: string
  source_url?: string
  title?: {
    rendered?: string
  }
}

function makeAssetHtml(asset: LoadedAsset, media: WordPressMediaRecord): string {
  const escapedAlt = asset.altText
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

  return `<figure><img alt="${escapedAlt}" src="${media.sourceUrl}" /></figure>`
}

function sortContentItems(items: LoadedContentItem[]): LoadedContentItem[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const sortedIds = [...byId.keys()].sort((left, right) => left.localeCompare(right))
  const visited = new Set<string>()
  const result: LoadedContentItem[] = []

  const visit = (id: string) => {
    if (visited.has(id)) {
      return
    }

    visited.add(id)
    const item = byId.get(id)
    if (!item) {
      return
    }

    if (item.parentId) {
      visit(item.parentId)
    }

    result.push(item)
  }

  const ordered = items.slice().sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'page' ? -1 : 1
    }

    return left.slug.localeCompare(right.slug)
  })

  for (const item of ordered) {
    visit(item.id)
  }

  const deduped = new Set<string>()
  return result
    .filter((item) => {
      if (deduped.has(item.id)) {
        return false
      }

      deduped.add(item.id)
      return true
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'page' ? -1 : 1
      }

      const leftIndex = sortedIds.indexOf(left.id)
      const rightIndex = sortedIds.indexOf(right.id)
      return leftIndex - rightIndex
    })
}

export async function applyDatasetToWordPress(
  dataset: LoadedDataset,
  transport: WordPressTransport,
): Promise<WordPressApplyResult> {
  const validation = validateDataset(dataset)
  if (!validation.valid) {
    const details = validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n')
    throw new Error(`Dataset validation failed:\n${details}`)
  }

  const termIds = new Map<string, number>()
  const terms: WordPressTermRecord[] = []

  for (const taxonomy of ['category', 'tag'] as const) {
    const scopedTerms = dataset.terms
      .filter((term) => term.taxonomy === taxonomy)
      .sort((left, right) => left.slug.localeCompare(right.slug))

    for (const term of scopedTerms) {
      const record = await transport.upsertTerm({
        description: term.description,
        name: term.name,
        slug: term.slug,
        taxonomy,
      })

      terms.push(record)
      termIds.set(`${taxonomy}:${term.slug}`, record.id)
    }
  }

  const mediaById = new Map<string, WordPressMediaRecord>()
  const media: WordPressMediaRecord[] = []

  for (const asset of dataset.assets.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const bytes = await readFile(asset.filePath)
    const record = await transport.upsertMedia({
      altText: asset.altText,
      bytes,
      filename: asset.filename,
      mimeType: asset.mimeType,
      slug: asset.id,
      title: asset.title,
    })

    media.push(record)
    mediaById.set(asset.id, record)
  }

  const contentById = new Map<string, WordPressContentRecord>()
  const content: WordPressContentRecord[] = []

  for (const item of sortContentItems(dataset.contentItems)) {
    const bodyHtml = renderBodyToHtml(item.body, item.bodyFormat, (assetId) => {
      const asset = dataset.assets.find((candidate) => candidate.id === assetId)
      const mediaRecord = mediaById.get(assetId)

      if (!asset || !mediaRecord) {
        throw new Error(`Missing asset for inline placeholder: ${assetId}`)
      }

      return makeAssetHtml(asset, mediaRecord)
    })

    const taxonomyTermIds: Partial<Record<TaxonomyKind, number[]>> = {}

    for (const taxonomy of ['category', 'tag'] as const) {
      const ids = (item.taxonomySlugs?.[taxonomy] ?? []).map((slug) => termIds.get(`${taxonomy}:${slug}`) ?? 0)
      if (ids.length > 0) {
        taxonomyTermIds[taxonomy] = ids
      }
    }

    const record = await transport.upsertContent({
      bodyHtml,
      excerpt: item.excerpt,
      featuredMediaId: item.featuredAssetId ? mediaById.get(item.featuredAssetId)?.id : undefined,
      kind: item.kind,
      parentId: item.parentId ? contentById.get(item.parentId)?.id : undefined,
      slug: item.slug,
      status: item.targets?.wordpress?.status ?? 'publish',
      sticky: item.targets?.wordpress?.sticky,
      taxonomyTermIds,
      template: item.targets?.wordpress?.template,
      title: item.title,
    })

    content.push(record)
    contentById.set(item.id, record)
  }

  return {
    content,
    media,
    terms,
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '')
}

function assertSecureAuthenticatedBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl)

  if (url.protocol === 'https:') {
    return
  }

  if (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(normalizeHostname(url.hostname))) {
    return
  }

  throw new Error(
    `Authenticated WordPress requests require HTTPS unless WORDPRESS_ENDPOINT uses localhost, 127.0.0.1, or ::1: ${url.toString()}`,
  )
}

function mapKindToEndpoint(kind: ContentKind | TaxonomyKind | 'media'): string {
  if (kind === 'article') {
    return 'posts'
  }

  if (kind === 'category') {
    return 'categories'
  }

  if (kind === 'media') {
    return 'media'
  }

  if (kind === 'page') {
    return 'pages'
  }

  return 'tags'
}

export function createWordPressRestTransport(
  options: WordPressConnectionOptions,
  fetchImpl: typeof fetch = fetch,
): WordPressTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  assertSecureAuthenticatedBaseUrl(baseUrl)
  const authHeader = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const url = `${baseUrl}/wp-json/wp/v2/${path.replace(/^\/+/, '')}`
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: authHeader,
        ...(init?.headers ?? {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(WORDPRESS_REQUEST_TIMEOUT_MS),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      const loginHint =
        location?.includes('/wp-login.php') || location?.includes('/wp-json/')
          ? ' Unexpected redirect during authenticated REST access. If you are using WordPress Playground, start it without `--login` for API clients.'
          : ''

      throw new Error(
        `WordPress request redirected unexpectedly: ${response.status} ${response.statusText}${location ? ` -> ${location}` : ''}.${loginHint}`,
      )
    }

    if (!response.ok) {
      const responseText = await response.text()
      const bodyDetail = responseText.trim() ? ` Response: ${responseText.trim().slice(0, 300)}` : ''
      const authHint =
        response.status === 401
          ? ' Basic Auth write requests usually require a WordPress application password unless the target explicitly accepts normal passwords.'
          : ''

      throw new Error(`WordPress request failed: ${response.status} ${response.statusText}.${authHint}${bodyDetail}`)
    }

    return (await response.json()) as T
  }

  const findBySlug = async (endpoint: string, slug: string): Promise<RawRestEntity | undefined> => {
    const query = new URLSearchParams({ slug })
    const records = await request<RawRestEntity[]>(`${endpoint}?${query.toString()}`)
    return records.find((record) => record.slug === slug)
  }

  const upsertContent = async (input: WordPressContentInput): Promise<WordPressContentRecord> => {
    const endpoint = mapKindToEndpoint(input.kind)
    const existing = await findBySlug(endpoint, input.slug)
    const body = JSON.stringify({
      categories: input.taxonomyTermIds?.category,
      content: input.bodyHtml,
      excerpt: input.excerpt,
      featured_media: input.featuredMediaId,
      parent: input.parentId,
      slug: input.slug,
      status: input.status,
      sticky: input.sticky,
      tags: input.taxonomyTermIds?.tag,
      template: input.template,
      title: input.title,
    })

    const record = existing
      ? await request<RawRestEntity>(`${endpoint}/${existing.id}`, {
          body,
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
      : await request<RawRestEntity>(endpoint, {
          body,
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })

    return {
      id: record.id,
      kind: input.kind,
      slug: input.slug,
      title: input.title,
    }
  }

  const upsertMedia = async (input: WordPressMediaInput): Promise<WordPressMediaRecord> => {
    const endpoint = mapKindToEndpoint('media')
    const existing = await findBySlug(endpoint, input.slug)

    if (existing) {
      const updated = await request<RawRestEntity>(`${endpoint}/${existing.id}`, {
        body: JSON.stringify({
          alt_text: input.altText,
          slug: input.slug,
          title: input.title,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      return {
        altText: input.altText,
        id: updated.id,
        slug: input.slug,
        sourceUrl: updated.source_url ?? `${baseUrl}/wp-content/uploads/${input.filename}`,
        title: input.title,
      }
    }

    const formData = new FormData()
    formData.set('alt_text', input.altText)
    formData.set('file', new File([input.bytes], input.filename, { type: input.mimeType }))
    formData.set('slug', input.slug)
    formData.set('status', 'publish')
    formData.set('title', input.title)

    const created = await request<RawRestEntity>(endpoint, {
      body: formData,
      method: 'POST',
    })

    return {
      altText: input.altText,
      id: created.id,
      slug: input.slug,
      sourceUrl: created.source_url ?? `${baseUrl}/wp-content/uploads/${input.filename}`,
      title: input.title,
    }
  }

  const upsertTerm = async (input: WordPressTermInput): Promise<WordPressTermRecord> => {
    const endpoint = mapKindToEndpoint(input.taxonomy)
    const existing = await findBySlug(endpoint, input.slug)
    const body = JSON.stringify({
      description: input.description,
      name: input.name,
      slug: input.slug,
    })

    const record = existing
      ? await request<RawRestEntity>(`${endpoint}/${existing.id}`, {
          body,
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })
      : await request<RawRestEntity>(endpoint, {
          body,
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })

    return {
      description: input.description,
      id: record.id,
      name: input.name,
      slug: input.slug,
      taxonomy: input.taxonomy,
    }
  }

  return {
    upsertContent,
    upsertMedia,
    upsertTerm,
  }
}
