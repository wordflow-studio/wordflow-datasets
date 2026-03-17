export const CONTENT_TYPES = ['page', 'post'] as const
export const DATASET_STATES = ['draft', 'published'] as const
export const SOURCE_KINDS = ['image', 'mixed', 'other', 'text'] as const
export const SUPPORTED_SCHEMA_VERSION = '1.0.0' as const
export const TAXONOMY_TYPES = ['category', 'custom', 'tag'] as const

export type ContentType = (typeof CONTENT_TYPES)[number]
export type DatasetState = (typeof DATASET_STATES)[number]
export type SourceKind = (typeof SOURCE_KINDS)[number]
export type SupportedSchemaVersion = typeof SUPPORTED_SCHEMA_VERSION
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number]
export type ValidationStatus = 'invalid' | 'unreadable' | 'valid'

export interface DatasetItem {
  excerpt?: string
  featuredAsset?: string
  locale: string
  slug: string
  sourceRefs: string[]
  state: DatasetState
  taxonomyRefs: string[]
  title: string
  type: ContentType
}

export interface DatasetManifest {
  description: string
  locale: string
  schemaVersion: SupportedSchemaVersion
  slug: string
  title: string
}

export interface SourceRecord {
  author?: string
  id: string
  kind: SourceKind
  license: string
  name: string
  originalUrl?: string
}

export interface TaxonomyDefinition {
  label: string
  slug: string
  terms: TaxonomyTerm[]
  type: TaxonomyType
}

export interface TaxonomyTerm {
  label: string
  slug: string
}

export interface ValidationIssue {
  code: string
  message: string
  path: string
}

export interface ValidationReport {
  datasetPath: string
  errorCount: number
  errors: ValidationIssue[]
  itemCount: number
  status: ValidationStatus
  valid: boolean
  warningCount: number
  warnings: ValidationIssue[]
}
