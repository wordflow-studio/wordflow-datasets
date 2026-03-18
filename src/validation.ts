import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep, win32 } from 'node:path'
import type {
  ContentType,
  DatasetItem,
  DatasetManifest,
  DatasetState,
  SourceKind,
  SourceRecord,
  TaxonomyDefinition,
  TaxonomyTerm,
  TaxonomyType,
  ValidationIssue,
  ValidationReport,
  ValidationStatus,
} from './types.ts'
import { CONTENT_TYPES, DATASET_STATES, SOURCE_KINDS, SUPPORTED_SCHEMA_VERSION, TAXONOMY_TYPES } from './types.ts'

const BCP_47_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
const REFERENCE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const URL_PATTERN = /^https?:\/\/\S+$/i

interface SourcesDocument {
  sources: SourceRecord[]
}

interface TaxonomiesDocument {
  taxonomies: TaxonomyDefinition[]
}

interface ValidationCollector {
  datasetPath: string
  errors: ValidationIssue[]
  unreadable: boolean
  warnings: ValidationIssue[]
}

function addError(collector: ValidationCollector, code: string, message: string, filePath: string) {
  collector.errors.push({
    code,
    message,
    path: filePath,
  })
}

function addUnreadableError(collector: ValidationCollector, code: string, message: string, filePath: string) {
  collector.unreadable = true
  addError(collector, code, message, filePath)
}

function addWarning(collector: ValidationCollector, code: string, message: string, filePath: string) {
  collector.warnings.push({
    code,
    message,
    path: filePath,
  })
}

function finalizeReport(collector: ValidationCollector, itemCount: number, status: ValidationStatus): ValidationReport {
  return {
    datasetPath: collector.datasetPath,
    errorCount: collector.errors.length,
    errors: collector.errors,
    itemCount,
    status,
    valid: status === 'valid',
    warningCount: collector.warnings.length,
    warnings: collector.warnings,
  }
}

function formatChildPath(parentPath: string, key: string): string {
  if (parentPath === '.') {
    return key
  }

  return `${parentPath}.${key}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isUnreadableFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return isErrnoException(error) && ['EACCES', 'EBUSY', 'EIO', 'EMFILE', 'ENFILE', 'EPERM'].includes(error.code ?? '')
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relativePath = relative(basePath, targetPath)

  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !relativePath.includes(`${sep}..${sep}`) &&
    !win32.isAbsolute(relativePath)
  )
}

function normalizePath(absolutePath: string, datasetPath: string): string {
  const relativePath = relative(datasetPath, absolutePath)

  if (relativePath === '') {
    return '.'
  }

  return relativePath.split(sep).join('/')
}

function requireArray(
  value: Record<string, unknown>,
  key: string,
  collector: ValidationCollector,
  filePath: string,
): unknown[] | null {
  const arrayValue = value[key]

  if (!Array.isArray(arrayValue)) {
    addError(collector, 'invalid-schema', `${key} must be an array.`, formatChildPath(filePath, key))
    return null
  }

  return arrayValue
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  collector: ValidationCollector,
  filePath: string,
): string | null {
  const stringValue = value[key]

  if (typeof stringValue !== 'string' || stringValue.trim() === '') {
    addError(collector, 'invalid-schema', `${key} must be a non-empty string.`, formatChildPath(filePath, key))
    return null
  }

  return stringValue
}

function requireStringArray(
  value: Record<string, unknown>,
  key: string,
  collector: ValidationCollector,
  filePath: string,
): string[] | null {
  const arrayValue = requireArray(value, key, collector, filePath)

  if (arrayValue === null) {
    return null
  }

  const strings: string[] = []

  for (const [index, entry] of arrayValue.entries()) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      addError(
        collector,
        'invalid-schema',
        `${key} entries must be non-empty strings.`,
        `${formatChildPath(filePath, key)}[${index}]`,
      )
      continue
    }

    strings.push(entry)
  }

  return strings
}

function validateAdditionalProperties(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  collector: ValidationCollector,
  filePath: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      addError(collector, 'unknown-field', `Unexpected field ${key} is not allowed.`, formatChildPath(filePath, key))
    }
  }
}

function validateLocale(locale: string, collector: ValidationCollector, filePath: string) {
  if (!BCP_47_PATTERN.test(locale)) {
    addError(collector, 'invalid-locale', 'Locale must use a BCP 47 style tag.', filePath)
  }
}

function validateReference(reference: string, collector: ValidationCollector, filePath: string) {
  if (!REFERENCE_PATTERN.test(reference)) {
    addError(collector, 'invalid-reference', 'References must use the format <taxonomy-slug>:<term-slug>.', filePath)
  }
}

function validateSlug(slug: string, collector: ValidationCollector, filePath: string) {
  if (!SLUG_PATTERN.test(slug)) {
    addError(collector, 'invalid-slug', 'Slugs must use lowercase letters, numbers, and hyphens only.', filePath)
  }
}

function validateUrl(url: string, collector: ValidationCollector, filePath: string) {
  if (!URL_PATTERN.test(url)) {
    addError(collector, 'invalid-url', 'URLs must use http or https.', filePath)
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const directoryStat = await stat(directoryPath)
    return directoryStat.isDirectory()
  } catch {
    return false
  }
}

async function validateRealPathWithinDataset(
  absolutePath: string,
  collector: ValidationCollector,
  code: string,
  unreadableCode: string,
  filePath: string,
  message: string,
): Promise<boolean> {
  try {
    const [realDatasetPath, realTargetPath] = await Promise.all([
      realpath(collector.datasetPath),
      realpath(absolutePath),
    ])

    if (!isPathWithin(realDatasetPath, realTargetPath)) {
      addError(collector, code, message, filePath)
      return false
    }
  } catch (error) {
    if (isUnreadableFilesystemError(error)) {
      addUnreadableError(collector, unreadableCode, error.message, filePath)
      return false
    }

    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      const errorMessage = error instanceof Error ? error.message : 'Unknown path resolution error.'
      addError(collector, code, errorMessage, filePath)
      return false
    }
  }

  return true
}

async function readJsonDocument(
  absolutePath: string,
  collector: ValidationCollector,
): Promise<Record<string, unknown> | null> {
  const reportPath = normalizePath(absolutePath, collector.datasetPath)

  if (
    !(await validateRealPathWithinDataset(
      absolutePath,
      collector,
      'invalid-file-path',
      'unreadable-file',
      reportPath,
      'JSON documents must stay within the dataset directory after resolving symlinks.',
    ))
  ) {
    return null
  }

  try {
    const contents = await readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(contents) as unknown

    if (!isRecord(parsed)) {
      addError(collector, 'invalid-json', 'JSON documents must contain an object at the top level.', reportPath)
      return null
    }

    return parsed
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      addError(collector, 'missing-file', 'File is required.', reportPath)
      return null
    }

    if (isUnreadableFilesystemError(error)) {
      addUnreadableError(collector, 'unreadable-file', error.message, reportPath)
      return null
    }

    const message = error instanceof Error ? error.message : 'Unknown read error.'
    addError(collector, 'invalid-json', message, reportPath)
    return null
  }
}

async function readDirectoryEntries(absolutePath: string, collector: ValidationCollector, filePath: string) {
  try {
    return await readdir(absolutePath, {
      withFileTypes: true,
    })
  } catch (error) {
    if (isUnreadableFilesystemError(error)) {
      addUnreadableError(collector, 'unreadable-directory', error.message, filePath)
      return null
    }

    throw error
  }
}

async function validateReadableFile(
  absolutePath: string,
  collector: ValidationCollector,
  filePath: string,
  missingMessage: string,
): Promise<boolean> {
  try {
    await readFile(absolutePath, 'utf8')
    return true
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      addError(collector, 'missing-file', missingMessage, filePath)
      return false
    }

    const message = error instanceof Error ? error.message : 'Unknown read error.'
    addUnreadableError(collector, 'unreadable-file', message, filePath)
    return false
  }
}

function parseDatasetManifest(value: Record<string, unknown>, collector: ValidationCollector): DatasetManifest | null {
  const reportPath = 'dataset.json'
  validateAdditionalProperties(
    value,
    new Set(['description', 'locale', 'schemaVersion', 'slug', 'title']),
    collector,
    reportPath,
  )

  const description = requireNonEmptyString(value, 'description', collector, reportPath)
  const locale = requireNonEmptyString(value, 'locale', collector, reportPath)
  const schemaVersion = requireNonEmptyString(value, 'schemaVersion', collector, reportPath)
  const slug = requireNonEmptyString(value, 'slug', collector, reportPath)
  const title = requireNonEmptyString(value, 'title', collector, reportPath)

  if (locale !== null) {
    validateLocale(locale, collector, 'dataset.json.locale')
  }

  if (schemaVersion !== null && schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    addError(
      collector,
      'unsupported-schema-version',
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}.`,
      'dataset.json.schemaVersion',
    )
  }

  if (slug !== null) {
    validateSlug(slug, collector, 'dataset.json.slug')
  }

  if (
    description === null ||
    locale === null ||
    schemaVersion === null ||
    schemaVersion !== SUPPORTED_SCHEMA_VERSION ||
    slug === null ||
    title === null
  ) {
    return null
  }

  return {
    description,
    locale,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    slug,
    title,
  }
}

function parseSourceRecord(value: unknown, collector: ValidationCollector, filePath: string): SourceRecord | null {
  if (!isRecord(value)) {
    addError(collector, 'invalid-schema', 'Source records must be objects.', filePath)
    return null
  }

  validateAdditionalProperties(
    value,
    new Set(['author', 'id', 'kind', 'license', 'name', 'originalUrl']),
    collector,
    filePath,
  )

  const authorValue = value.author
  const id = requireNonEmptyString(value, 'id', collector, filePath)
  const kind = requireNonEmptyString(value, 'kind', collector, filePath)
  const license = requireNonEmptyString(value, 'license', collector, filePath)
  const name = requireNonEmptyString(value, 'name', collector, filePath)
  const originalUrlValue = value.originalUrl

  if (authorValue !== undefined && (typeof authorValue !== 'string' || authorValue.trim() === '')) {
    addError(collector, 'invalid-schema', 'author must be a non-empty string when provided.', `${filePath}.author`)
  }

  if (id !== null) {
    validateSlug(id, collector, `${filePath}.id`)
  }

  if (kind !== null && !SOURCE_KINDS.includes(kind as SourceKind)) {
    addError(collector, 'invalid-schema', `kind must be one of: ${SOURCE_KINDS.join(', ')}.`, `${filePath}.kind`)
  }

  if (originalUrlValue !== undefined) {
    if (typeof originalUrlValue !== 'string' || originalUrlValue.trim() === '') {
      addError(
        collector,
        'invalid-schema',
        'originalUrl must be a non-empty string when provided.',
        `${filePath}.originalUrl`,
      )
    } else {
      validateUrl(originalUrlValue, collector, `${filePath}.originalUrl`)
    }
  }

  if (id === null || kind === null || license === null || name === null || !SOURCE_KINDS.includes(kind as SourceKind)) {
    return null
  }

  return {
    author: typeof authorValue === 'string' ? authorValue : undefined,
    id,
    kind: kind as SourceKind,
    license,
    name,
    originalUrl: typeof originalUrlValue === 'string' ? originalUrlValue : undefined,
  }
}

function parseSourcesDocument(value: Record<string, unknown>, collector: ValidationCollector): SourcesDocument | null {
  const reportPath = 'sources.json'
  validateAdditionalProperties(value, new Set(['sources']), collector, reportPath)

  const sourcesValue = requireArray(value, 'sources', collector, reportPath)

  if (sourcesValue === null) {
    return null
  }

  const sourceIds = new Set<string>()
  const sources: SourceRecord[] = []

  for (const [index, sourceValue] of sourcesValue.entries()) {
    const source = parseSourceRecord(sourceValue, collector, `sources.json.sources[${index}]`)

    if (source === null) {
      continue
    }

    if (sourceIds.has(source.id)) {
      addError(
        collector,
        'duplicate-source-id',
        `Source id ${source.id} is duplicated.`,
        `sources.json.sources[${index}].id`,
      )
      continue
    }

    sourceIds.add(source.id)
    sources.push(source)
  }

  return {
    sources,
  }
}

function parseTaxonomyTerm(value: unknown, collector: ValidationCollector, filePath: string): TaxonomyTerm | null {
  if (!isRecord(value)) {
    addError(collector, 'invalid-schema', 'Taxonomy terms must be objects.', filePath)
    return null
  }

  validateAdditionalProperties(value, new Set(['label', 'slug']), collector, filePath)

  const label = requireNonEmptyString(value, 'label', collector, filePath)
  const slug = requireNonEmptyString(value, 'slug', collector, filePath)

  if (slug !== null) {
    validateSlug(slug, collector, `${filePath}.slug`)
  }

  if (label === null || slug === null) {
    return null
  }

  return {
    label,
    slug,
  }
}

function parseTaxonomyDefinition(
  value: unknown,
  collector: ValidationCollector,
  filePath: string,
): TaxonomyDefinition | null {
  if (!isRecord(value)) {
    addError(collector, 'invalid-schema', 'Taxonomy definitions must be objects.', filePath)
    return null
  }

  validateAdditionalProperties(value, new Set(['label', 'slug', 'terms', 'type']), collector, filePath)

  const label = requireNonEmptyString(value, 'label', collector, filePath)
  const slug = requireNonEmptyString(value, 'slug', collector, filePath)
  const termsValue = requireArray(value, 'terms', collector, filePath)
  const type = requireNonEmptyString(value, 'type', collector, filePath)

  if (slug !== null) {
    validateSlug(slug, collector, `${filePath}.slug`)
  }

  if (type !== null && !TAXONOMY_TYPES.includes(type as TaxonomyType)) {
    addError(collector, 'invalid-schema', `type must be one of: ${TAXONOMY_TYPES.join(', ')}.`, `${filePath}.type`)
  }

  const seenTermSlugs = new Set<string>()
  const terms: TaxonomyTerm[] = []

  if (termsValue !== null) {
    for (const [index, termValue] of termsValue.entries()) {
      const term = parseTaxonomyTerm(termValue, collector, `${filePath}.terms[${index}]`)

      if (term === null) {
        continue
      }

      if (seenTermSlugs.has(term.slug)) {
        addError(
          collector,
          'duplicate-taxonomy-term',
          `Term slug ${term.slug} is duplicated within taxonomy ${slug ?? 'unknown'}.`,
          `${filePath}.terms[${index}].slug`,
        )
        continue
      }

      seenTermSlugs.add(term.slug)
      terms.push(term)
    }
  }

  if (
    label === null ||
    slug === null ||
    termsValue === null ||
    type === null ||
    !TAXONOMY_TYPES.includes(type as TaxonomyType)
  ) {
    return null
  }

  return {
    label,
    slug,
    terms,
    type: type as TaxonomyType,
  }
}

function parseTaxonomiesDocument(
  value: Record<string, unknown>,
  collector: ValidationCollector,
): TaxonomiesDocument | null {
  const reportPath = 'taxonomies.json'
  validateAdditionalProperties(value, new Set(['taxonomies']), collector, reportPath)

  const taxonomiesValue = requireArray(value, 'taxonomies', collector, reportPath)

  if (taxonomiesValue === null) {
    return null
  }

  const seenTaxonomySlugs = new Set<string>()
  const taxonomies: TaxonomyDefinition[] = []

  for (const [index, taxonomyValue] of taxonomiesValue.entries()) {
    const taxonomy = parseTaxonomyDefinition(taxonomyValue, collector, `taxonomies.json.taxonomies[${index}]`)

    if (taxonomy === null) {
      continue
    }

    if (seenTaxonomySlugs.has(taxonomy.slug)) {
      addError(
        collector,
        'duplicate-taxonomy-slug',
        `Taxonomy slug ${taxonomy.slug} is duplicated.`,
        `taxonomies.json.taxonomies[${index}].slug`,
      )
      continue
    }

    seenTaxonomySlugs.add(taxonomy.slug)
    taxonomies.push(taxonomy)
  }

  return {
    taxonomies,
  }
}

function parseDatasetItem(
  value: Record<string, unknown>,
  collector: ValidationCollector,
  filePath: string,
): DatasetItem | null {
  validateAdditionalProperties(
    value,
    new Set(['excerpt', 'featuredAsset', 'locale', 'slug', 'sourceRefs', 'state', 'taxonomyRefs', 'title', 'type']),
    collector,
    filePath,
  )

  const excerptValue = value.excerpt
  const featuredAssetValue = value.featuredAsset
  const locale = requireNonEmptyString(value, 'locale', collector, filePath)
  const slug = requireNonEmptyString(value, 'slug', collector, filePath)
  const sourceRefs = requireStringArray(value, 'sourceRefs', collector, filePath)
  const state = requireNonEmptyString(value, 'state', collector, filePath)
  const taxonomyRefs = requireStringArray(value, 'taxonomyRefs', collector, filePath)
  const title = requireNonEmptyString(value, 'title', collector, filePath)
  const type = requireNonEmptyString(value, 'type', collector, filePath)

  if (excerptValue !== undefined && (typeof excerptValue !== 'string' || excerptValue.trim() === '')) {
    addError(collector, 'invalid-schema', 'excerpt must be a non-empty string when provided.', `${filePath}.excerpt`)
  }

  if (
    featuredAssetValue !== undefined &&
    (typeof featuredAssetValue !== 'string' || featuredAssetValue.trim() === '')
  ) {
    addError(
      collector,
      'invalid-schema',
      'featuredAsset must be a non-empty string when provided.',
      `${filePath}.featuredAsset`,
    )
  }

  if (locale !== null) {
    validateLocale(locale, collector, `${filePath}.locale`)
  }

  if (slug !== null) {
    validateSlug(slug, collector, `${filePath}.slug`)
  }

  if (sourceRefs !== null) {
    for (const [index, sourceRef] of sourceRefs.entries()) {
      validateSlug(sourceRef, collector, `${filePath}.sourceRefs[${index}]`)
    }
  }

  if (state !== null && !DATASET_STATES.includes(state as DatasetState)) {
    addError(collector, 'invalid-schema', `state must be one of: ${DATASET_STATES.join(', ')}.`, `${filePath}.state`)
  }

  if (taxonomyRefs !== null) {
    for (const [index, taxonomyRef] of taxonomyRefs.entries()) {
      validateReference(taxonomyRef, collector, `${filePath}.taxonomyRefs[${index}]`)
    }
  }

  if (type !== null && !CONTENT_TYPES.includes(type as ContentType)) {
    addError(collector, 'invalid-schema', `type must be one of: ${CONTENT_TYPES.join(', ')}.`, `${filePath}.type`)
  }

  if (
    locale === null ||
    slug === null ||
    sourceRefs === null ||
    state === null ||
    !DATASET_STATES.includes(state as DatasetState) ||
    taxonomyRefs === null ||
    title === null ||
    type === null ||
    !CONTENT_TYPES.includes(type as ContentType)
  ) {
    return null
  }

  return {
    excerpt: typeof excerptValue === 'string' ? excerptValue : undefined,
    featuredAsset: typeof featuredAssetValue === 'string' ? featuredAssetValue : undefined,
    locale,
    slug,
    sourceRefs,
    state: state as DatasetState,
    taxonomyRefs,
    title,
    type: type as ContentType,
  }
}

async function referenceAssetPath(
  assetPath: string,
  collector: ValidationCollector,
  filePath: string,
): Promise<string | null> {
  const absolutePath = resolve(collector.datasetPath, assetPath)

  if (!isPathWithin(collector.datasetPath, absolutePath)) {
    addError(collector, 'invalid-asset-path', 'featuredAsset must stay within the dataset directory.', filePath)
    return null
  }

  if (!(await fileExists(absolutePath))) {
    return absolutePath
  }

  try {
    const [realDatasetPath, realAssetPath] = await Promise.all([
      realpath(collector.datasetPath),
      realpath(absolutePath),
    ])

    if (!isPathWithin(realDatasetPath, realAssetPath)) {
      addError(
        collector,
        'invalid-asset-path',
        'featuredAsset must stay within the dataset directory after resolving symlinks.',
        filePath,
      )
      return null
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return absolutePath
    }

    const message = error instanceof Error ? error.message : 'Unknown asset path error.'
    addError(collector, 'invalid-asset-path', message, filePath)
    return null
  }

  return absolutePath
}

async function validateContentDirectory(
  collector: ValidationCollector,
  sourceIds: Set<string>,
  taxonomyRefs: Set<string>,
): Promise<number> {
  const contentDirectory = join(collector.datasetPath, 'content')

  if (!(await directoryExists(contentDirectory))) {
    addError(collector, 'missing-directory', 'Directory is required.', 'content')
    return 0
  }

  if (
    !(await validateRealPathWithinDataset(
      contentDirectory,
      collector,
      'invalid-directory-path',
      'unreadable-directory',
      'content',
      'content must stay within the dataset directory after resolving symlinks.',
    ))
  ) {
    return 0
  }

  let itemCount = 0
  const seenItemKeys = new Set<string>()
  const typeEntries = await readDirectoryEntries(contentDirectory, collector, 'content')

  if (typeEntries === null) {
    return 0
  }

  for (const typeEntry of typeEntries) {
    if (typeEntry.name.startsWith('.')) {
      continue
    }

    const typePath = join(contentDirectory, typeEntry.name)
    const reportTypePath = normalizePath(typePath, collector.datasetPath)

    if (!typeEntry.isDirectory()) {
      addError(collector, 'invalid-content-entry', 'Content entries must be directories.', reportTypePath)
      continue
    }

    if (!CONTENT_TYPES.includes(typeEntry.name as ContentType)) {
      addError(
        collector,
        'unsupported-content-type',
        `Content type ${typeEntry.name} is not supported.`,
        reportTypePath,
      )
      continue
    }

    const itemEntries = await readDirectoryEntries(typePath, collector, reportTypePath)

    if (itemEntries === null) {
      return itemCount
    }

    for (const itemEntry of itemEntries) {
      if (itemEntry.name.startsWith('.')) {
        continue
      }

      const itemDirectory = join(typePath, itemEntry.name)
      const reportItemDirectory = normalizePath(itemDirectory, collector.datasetPath)

      if (!itemEntry.isDirectory()) {
        addError(collector, 'invalid-item-entry', 'Content items must be directories.', reportItemDirectory)
        continue
      }

      itemCount += 1

      const bodyPath = join(itemDirectory, 'body.md')
      const itemJsonPath = join(itemDirectory, 'item.json')

      if (!(await fileExists(bodyPath))) {
        addError(
          collector,
          'missing-file',
          'body.md is required for every content item.',
          `${reportItemDirectory}/body.md`,
        )
      } else {
        const isBodyPathValid = await validateRealPathWithinDataset(
          bodyPath,
          collector,
          'invalid-file-path',
          'unreadable-file',
          `${reportItemDirectory}/body.md`,
          'body.md must stay within the dataset directory after resolving symlinks.',
        )

        if (isBodyPathValid) {
          await validateReadableFile(
            bodyPath,
            collector,
            `${reportItemDirectory}/body.md`,
            'body.md is required for every content item.',
          )
        }
      }

      const itemValue = await readJsonDocument(itemJsonPath, collector)

      if (itemValue === null) {
        continue
      }

      const item = parseDatasetItem(itemValue, collector, `${reportItemDirectory}/item.json`)

      if (item === null) {
        continue
      }

      if (item.slug !== itemEntry.name) {
        addError(
          collector,
          'slug-folder-mismatch',
          'The content folder name must match item.slug.',
          `${reportItemDirectory}/item.json.slug`,
        )
      }

      if (item.type !== typeEntry.name) {
        addError(
          collector,
          'item-type-mismatch',
          'item.type must match its parent content directory.',
          `${reportItemDirectory}/item.json.type`,
        )
      }

      const itemKey = `${item.type}:${item.locale}:${item.slug}`

      if (seenItemKeys.has(itemKey)) {
        addError(
          collector,
          'duplicate-item-slug',
          `Duplicate item slug ${item.slug} found for ${item.type} in locale ${item.locale}.`,
          `${reportItemDirectory}/item.json.slug`,
        )
      } else {
        seenItemKeys.add(itemKey)
      }

      for (const [index, sourceRef] of item.sourceRefs.entries()) {
        if (!sourceIds.has(sourceRef)) {
          addError(
            collector,
            'unknown-source-ref',
            `Source reference ${sourceRef} was not found in sources.json.`,
            `${reportItemDirectory}/item.json.sourceRefs[${index}]`,
          )
        }
      }

      for (const [index, taxonomyRef] of item.taxonomyRefs.entries()) {
        if (!taxonomyRefs.has(taxonomyRef)) {
          addError(
            collector,
            'unknown-taxonomy-ref',
            `Taxonomy reference ${taxonomyRef} was not found in taxonomies.json.`,
            `${reportItemDirectory}/item.json.taxonomyRefs[${index}]`,
          )
        }
      }

      if (item.featuredAsset !== undefined) {
        const featuredAssetPath = await referenceAssetPath(
          item.featuredAsset,
          collector,
          `${reportItemDirectory}/item.json.featuredAsset`,
        )

        if (featuredAssetPath !== null && !(await fileExists(featuredAssetPath))) {
          addError(
            collector,
            'missing-featured-asset',
            `featuredAsset ${item.featuredAsset} does not exist.`,
            `${reportItemDirectory}/item.json.featuredAsset`,
          )
        }
      }
    }
  }

  return itemCount
}

export async function validateDataset(datasetPath: string): Promise<ValidationReport> {
  const absoluteDatasetPath = resolve(datasetPath)
  const collector: ValidationCollector = {
    datasetPath: absoluteDatasetPath,
    errors: [],
    unreadable: false,
    warnings: [],
  }

  if (!(await directoryExists(absoluteDatasetPath))) {
    addError(collector, 'dataset-not-found', 'Dataset path must be an existing directory.', '.')
    return finalizeReport(collector, 0, 'unreadable')
  }

  for (const requiredDirectory of ['assets']) {
    const absolutePath = join(absoluteDatasetPath, requiredDirectory)
    const reportPath = normalizePath(absolutePath, absoluteDatasetPath)

    if (!(await directoryExists(absolutePath))) {
      addError(collector, 'missing-directory', `Directory ${requiredDirectory} is required.`, reportPath)
      continue
    }

    await validateRealPathWithinDataset(
      absolutePath,
      collector,
      'invalid-directory-path',
      'unreadable-directory',
      reportPath,
      `${requiredDirectory} must stay within the dataset directory after resolving symlinks.`,
    )
  }

  const datasetValue = await readJsonDocument(join(absoluteDatasetPath, 'dataset.json'), collector)
  const sourcesValue = await readJsonDocument(join(absoluteDatasetPath, 'sources.json'), collector)
  const taxonomiesValue = await readJsonDocument(join(absoluteDatasetPath, 'taxonomies.json'), collector)

  const readmePath = join(absoluteDatasetPath, 'README.md')

  if (!(await fileExists(readmePath))) {
    addError(collector, 'missing-file', 'README.md is required.', 'README.md')
  } else {
    const isReadmePathValid = await validateRealPathWithinDataset(
      readmePath,
      collector,
      'invalid-file-path',
      'unreadable-file',
      'README.md',
      'README.md must stay within the dataset directory after resolving symlinks.',
    )

    if (isReadmePathValid) {
      await validateReadableFile(readmePath, collector, 'README.md', 'README.md is required.')
    }
  }

  const manifest = datasetValue === null ? null : parseDatasetManifest(datasetValue, collector)
  const sourcesDocument = sourcesValue === null ? null : parseSourcesDocument(sourcesValue, collector)
  const taxonomiesDocument = taxonomiesValue === null ? null : parseTaxonomiesDocument(taxonomiesValue, collector)

  const sourceIds = new Set((sourcesDocument?.sources ?? []).map((source) => source.id))
  const taxonomyRefs = new Set(
    (taxonomiesDocument?.taxonomies ?? []).flatMap((taxonomy) =>
      taxonomy.terms.map((term) => `${taxonomy.slug}:${term.slug}`),
    ),
  )

  if (manifest !== null && manifest.slug !== absoluteDatasetPath.split(sep).at(-1)) {
    addWarning(
      collector,
      'dataset-folder-mismatch',
      'Dataset folder name does not match dataset.json slug.',
      'dataset.json.slug',
    )
  }

  const itemCount = await validateContentDirectory(collector, sourceIds, taxonomyRefs)
  const status: ValidationStatus = collector.unreadable
    ? 'unreadable'
    : collector.errors.length === 0
      ? 'valid'
      : 'invalid'
  return finalizeReport(collector, itemCount, status)
}
