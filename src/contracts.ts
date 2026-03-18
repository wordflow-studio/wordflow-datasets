export type ContentBodyFormat = 'html' | 'markdown'

export type ContentKind = 'article' | 'page'

export type DatasetSourceKind = 'generated' | 'upstream' | 'vendor'

export type DatasetTarget = 'wordpress'

export type TaxonomyKind = 'category' | 'tag'

export type WordPressContentStatus = 'draft' | 'publish'

export type WordPressContentExtension = {
  commentStatus?: 'closed' | 'open'
  status?: WordPressContentStatus
  sticky?: boolean
  template?: string
}

export type DatasetManifest = {
  datasetVersion: string
  defaultLocale: string
  description: string
  id: string
  label: string
  targets: DatasetTarget[]
}

export type DatasetSite = {
  description: string
  title: string
  url: string
}

export type DatasetSource = {
  id: string
  kind: DatasetSourceKind
  license: string
  note?: string
  title: string
  url: string
  version: string
}

export type DatasetSourcesFile = {
  sources: DatasetSource[]
}

export type DatasetTerm = {
  description?: string
  name: string
  parentSlug?: string
  slug: string
  taxonomy: TaxonomyKind
}

export type DatasetTaxonomiesFile = {
  terms: DatasetTerm[]
}

export type DatasetAsset = {
  altText: string
  credit?: string
  filename: string
  id: string
  mimeType: string
  sourceIds: string[]
  title: string
}

export type DatasetAssetsFile = {
  assets: DatasetAsset[]
}

export type DatasetContentTaxonomySlugs = {
  category?: string[]
  tag?: string[]
}

export type DatasetContentTargets = {
  wordpress?: WordPressContentExtension
}

export type DatasetContentItem = {
  bodyFormat: ContentBodyFormat
  excerpt?: string
  featuredAssetId?: string
  id: string
  kind: ContentKind
  locale: string
  parentId?: string
  slug: string
  sourceIds: string[]
  summary?: string
  targets?: DatasetContentTargets
  taxonomySlugs?: DatasetContentTaxonomySlugs
  title: string
}

export type LoadedAsset = DatasetAsset & {
  filePath: string
}

export type LoadedContentItem = DatasetContentItem & {
  body: string
  bodyPath: string
}

export type LoadedDataset = {
  assets: LoadedAsset[]
  contentItems: LoadedContentItem[]
  manifest: DatasetManifest
  rootDir: string
  site: DatasetSite
  sources: DatasetSource[]
  terms: DatasetTerm[]
}

export type ValidationError = {
  message: string
  path: string
}

export type ValidationResult = {
  errors: ValidationError[]
  valid: boolean
}

export type DatasetSummary = {
  articleCount: number
  assetCount: number
  pageCount: number
  sourceCount: number
  termCount: number
}

export type WordPressTermInput = {
  description?: string
  name: string
  slug: string
  taxonomy: TaxonomyKind
}

export type WordPressTermRecord = WordPressTermInput & {
  id: number
}

export type WordPressMediaInput = {
  altText: string
  bytes: Uint8Array
  filename: string
  mimeType: string
  slug: string
  title: string
}

export type WordPressMediaRecord = {
  altText: string
  id: number
  slug: string
  sourceUrl: string
  title: string
}

export type WordPressContentInput = {
  bodyHtml: string
  excerpt?: string
  featuredMediaId?: number
  kind: ContentKind
  parentId?: number
  slug: string
  status: WordPressContentStatus
  sticky?: boolean
  taxonomyTermIds?: Partial<Record<TaxonomyKind, number[]>>
  template?: string
  title: string
}

export type WordPressContentRecord = {
  id: number
  kind: ContentKind
  slug: string
  title: string
}

export type WordPressApplyResult = {
  content: WordPressContentRecord[]
  media: WordPressMediaRecord[]
  terms: WordPressTermRecord[]
}

export type WordPressConnectionOptions = {
  password: string
  baseUrl: string
  username: string
}

export interface WordPressTransport {
  upsertContent(input: WordPressContentInput): Promise<WordPressContentRecord>
  upsertMedia(input: WordPressMediaInput): Promise<WordPressMediaRecord>
  upsertTerm(input: WordPressTermInput): Promise<WordPressTermRecord>
}
