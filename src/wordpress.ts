import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { marked } from 'marked'
import type { ContentType, DatasetItem, DatasetManifest, TaxonomyDefinition, TaxonomyType } from './types.ts'
import { CONTENT_TYPES } from './types.ts'
import { validateDataset } from './validation.ts'

const BLOCK_MARKUP_PATTERN = /<!--\s*wp:/i
const CHANNEL_AUTHOR_DISPLAY_NAME = 'Wordflow Dataset'
const CHANNEL_AUTHOR_EMAIL = 'datasets@wordflow.studio'
const CHANNEL_AUTHOR_LOGIN = 'wordflow-dataset'
const CHANNEL_LANGUAGE_DEFAULT = 'en'
const CHANNEL_PUB_DATE = new Date('2026-01-01T00:00:00Z')
const CHANNEL_SCHEMA_URL = 'https://playground.wordpress.net/blueprint-schema.json'
const CHANNEL_SITE_URL_PREFIX = 'https://example.com/datasets'
const CHANNEL_WXR_VERSION = '1.2'
const DEFAULT_COMMENT_STATUS = 'closed'
const DEFAULT_MENU_ORDER = 0
const DEFAULT_PING_STATUS = 'closed'
const DEFAULT_POST_PARENT = 0
const EXPECTED_BLUEPRINT_FILENAME = 'blueprint.json'
const EXPECTED_WORDPRESS_IMPORTER_FILENAME = 'wordpress-importer.zip'
const EXPECTED_WXR_FILENAME = 'dataset.wxr'
const EXPECTED_WXR_PLAYGROUND_PATH = '/tmp/wordflow-dataset.wxr'
const PREFERRED_PHP_VERSION = '8.3'
const PREFERRED_WORDPRESS_VERSION = '6.9.4'
const SUPPORTED_TAXONOMY_TYPES = new Set<TaxonomyType>(['category', 'tag'])
const WORDPRESS_CACHE_DIRECTORY_PATH = resolve(import.meta.dir, '../.cache/wordpress')
const WORDPRESS_CORE_RELEASE_URL = 'https://wordpress.org/wordpress-6.9.4.zip'
const WORDPRESS_CORE_VERSION = '6.9.4'
const WORDPRESS_IMPORTER_RELEASE_URL = 'https://downloads.wordpress.org/plugin/wordpress-importer.0.9.5.zip'
const WORDPRESS_IMPORTER_VERSION = '0.9.5'

type XmlChild = XmlNode | XmlRaw | string

interface CreateWordPressSmokeBundleOptions {
  importerZipPath: string
  wordpressVersion: string
}

interface DatasetSourcesDocument {
  sources: Array<{
    id: string
  }>
}

interface DatasetTaxonomiesDocument {
  taxonomies: TaxonomyDefinition[]
}

interface LoadedWordPressDataset {
  description: string
  items: LoadedWordPressDatasetItem[]
  locale: string
  slug: string
  title: string
}

interface LoadedWordPressDatasetItem {
  content: string
  excerpt: string
  slug: string
  state: DatasetItem['state']
  taxonomyTerms: LoadedWordPressTaxonomyTerm[]
  title: string
  type: ContentType
}

interface LoadedWordPressTaxonomyTerm {
  label: string
  slug: string
  type: Extract<TaxonomyType, 'category' | 'tag'>
}

interface WordPressSmokeSpecification {
  expectedItems: Array<{
    content: string
    excerpt: string
    slug: string
    state: DatasetItem['state']
    taxonomies: Array<{
      slugs: string[]
      taxonomy: 'category' | 'post_tag'
    }>
    title: string
    type: ContentType
  }>
  siteOptions: {
    blogdescription: string
    blogname: string
  }
}

interface WordPressSmokeAssets {
  importerZipPath: string
  wordpressVersion: string
  wordpressZipPath: string
}

interface XmlNode {
  attributes?: Record<string, string>
  children?: XmlChild[]
  name: string
}

interface XmlRaw {
  kind: 'raw'
  value: string
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatPubDate(date: Date): string {
  return date.toUTCString().replace('GMT', '+0000')
}

function formatWordPressDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function xmlRaw(value: string): XmlRaw {
  return {
    kind: 'raw',
    value,
  }
}

function xmlNode(name: string, children?: XmlChild[], attributes?: Record<string, string>): XmlNode {
  return {
    attributes,
    children,
    name,
  }
}

function renderXmlChildInline(child: XmlChild): string {
  if (typeof child === 'string') {
    return escapeXml(child)
  }

  if ('kind' in child) {
    return child.value
  }

  return renderXmlNode(child, 0)
}

function renderXmlNode(node: XmlNode, indentationLevel: number): string {
  const attributes = Object.entries(node.attributes ?? {})
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
  const indentation = '\t'.repeat(indentationLevel)

  if (!node.children || node.children.length === 0) {
    return `${indentation}<${node.name}${attributes}/>`
  }

  const hasNestedNodes = node.children.some((child) => typeof child !== 'string' && !('kind' in child))

  if (!hasNestedNodes) {
    const content = node.children.map((child) => renderXmlChildInline(child)).join('')

    return `${indentation}<${node.name}${attributes}>${content}</${node.name}>`
  }

  return [
    `${indentation}<${node.name}${attributes}>`,
    ...node.children.map((child) => {
      if (typeof child === 'string' || 'kind' in child) {
        return `${'\t'.repeat(indentationLevel + 1)}${renderXmlChildInline(child)}`
      }

      return renderXmlNode(child, indentationLevel + 1)
    }),
    `${indentation}</${node.name}>`,
  ].join('\n')
}

function getBaseSiteUrl(datasetSlug: string): string {
  return `${CHANNEL_SITE_URL_PREFIX}/${datasetSlug}`
}

function getChannelLanguage(locale: string): string {
  return locale.split('-')[0] || CHANNEL_LANGUAGE_DEFAULT
}

function isSupportedWordPressTaxonomyType(type: TaxonomyType): type is Extract<TaxonomyType, 'category' | 'tag'> {
  return SUPPORTED_TAXONOMY_TYPES.has(type)
}

function getWordPressTaxonomyName(type: LoadedWordPressTaxonomyTerm['type']): 'category' | 'post_tag' {
  if (type === 'category') {
    return 'category'
  }

  return 'post_tag'
}

function renderWordPressContent(body: string): string {
  if (BLOCK_MARKUP_PATTERN.test(body)) {
    return body.trim()
  }

  return marked.parse(body, { async: false }) as string
}

function sortItems(items: LoadedWordPressDatasetItem[]): LoadedWordPressDatasetItem[] {
  return [...items].sort((left, right) => {
    const typeComparison = left.type.localeCompare(right.type)

    if (typeComparison !== 0) {
      return typeComparison
    }

    return left.slug.localeCompare(right.slug)
  })
}

function sortTaxonomyTerms(terms: LoadedWordPressTaxonomyTerm[]): LoadedWordPressTaxonomyTerm[] {
  return [...terms].sort((left, right) => {
    const typeComparison = left.type.localeCompare(right.type)

    if (typeComparison !== 0) {
      return typeComparison
    }

    return left.slug.localeCompare(right.slug)
  })
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  await writeFile(destinationPath, Buffer.from(await response.arrayBuffer()))
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, 'utf8')
  return JSON.parse(contents) as T
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    const fileStats = await stat(filePath)

    if (!fileStats.isFile()) {
      throw new Error(`Expected a file at ${filePath}.`)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Expected a file at ${filePath}.`)
    }

    throw error
  }
}

async function readValidatedDataset(datasetPath: string): Promise<LoadedWordPressDataset> {
  const absoluteDatasetPath = resolve(datasetPath)
  const report = await validateDataset(absoluteDatasetPath)

  if (!report.valid) {
    const formattedIssues = [...report.errors, ...report.warnings]
      .map((issue) => `${issue.code} ${issue.path}: ${issue.message}`)
      .join('\n')

    throw new Error(`Dataset must validate before WordPress apply smoke runs.\n${formattedIssues}`)
  }

  const [manifest, sourcesDocument, taxonomiesDocument] = await Promise.all([
    readJsonFile<DatasetManifest>(join(absoluteDatasetPath, 'dataset.json')),
    readJsonFile<DatasetSourcesDocument>(join(absoluteDatasetPath, 'sources.json')),
    readJsonFile<DatasetTaxonomiesDocument>(join(absoluteDatasetPath, 'taxonomies.json')),
  ])

  const sourceIds = new Set(
    sourcesDocument.sources.map((source) => source.id).sort((left, right) => left.localeCompare(right)),
  )
  const taxonomyByReference = new Map<string, LoadedWordPressTaxonomyTerm>()

  for (const taxonomy of [...taxonomiesDocument.taxonomies].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  )) {
    if (!isSupportedWordPressTaxonomyType(taxonomy.type)) {
      throw new Error(`WordPress smoke harness does not support taxonomy type "${taxonomy.type}".`)
    }

    for (const term of [...taxonomy.terms].sort((left, right) => left.slug.localeCompare(right.slug))) {
      taxonomyByReference.set(`${taxonomy.slug}:${term.slug}`, {
        label: term.label,
        slug: term.slug,
        type: taxonomy.type,
      })
    }
  }

  const items: LoadedWordPressDatasetItem[] = []

  for (const type of CONTENT_TYPES) {
    const contentTypeDirectoryPath = join(absoluteDatasetPath, 'content', type)
    let directoryEntries: Array<{
      isDirectory(): boolean
      name: string
    }>

    try {
      directoryEntries = await readdir(contentTypeDirectoryPath, {
        withFileTypes: true,
      })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }

      throw error
    }

    for (const directoryEntry of directoryEntries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const contentItemDirectoryPath = join(contentTypeDirectoryPath, directoryEntry.name)
      const [body, item] = await Promise.all([
        readFile(join(contentItemDirectoryPath, 'body.md'), 'utf8'),
        readJsonFile<DatasetItem>(join(contentItemDirectoryPath, 'item.json')),
      ])

      if (item.featuredAsset) {
        throw new Error(`WordPress smoke harness does not support featured assets yet: ${type}/${item.slug}`)
      }

      if (item.type === 'page' && item.taxonomyRefs.length > 0) {
        throw new Error(`WordPress smoke harness does not support taxonomy refs on pages yet: ${item.slug}`)
      }

      for (const sourceRef of item.sourceRefs) {
        if (!sourceIds.has(sourceRef)) {
          throw new Error(`WordPress smoke harness found an unknown source ref: ${sourceRef}`)
        }
      }

      const taxonomyTerms = sortTaxonomyTerms(
        item.taxonomyRefs.map((taxonomyRef) => {
          const taxonomy = taxonomyByReference.get(taxonomyRef)

          if (!taxonomy) {
            throw new Error(`WordPress smoke harness found an unknown taxonomy ref: ${taxonomyRef}`)
          }

          return taxonomy
        }),
      )

      items.push({
        content: renderWordPressContent(body),
        excerpt: item.excerpt ?? '',
        slug: item.slug,
        state: item.state,
        taxonomyTerms,
        title: item.title,
        type: item.type,
      })
    }
  }

  return {
    description: manifest.description,
    items: sortItems(items),
    locale: manifest.locale,
    slug: manifest.slug,
    title: manifest.title,
  }
}

function renderTopLevelTaxonomyTerms(items: LoadedWordPressDatasetItem[]): XmlNode[] {
  const uniqueTerms = new Map<string, LoadedWordPressTaxonomyTerm>()

  for (const item of items) {
    for (const term of item.taxonomyTerms) {
      uniqueTerms.set(`${term.type}:${term.slug}`, term)
    }
  }

  return [...uniqueTerms.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, term], index) => {
      const termId = index + 1

      if (term.type === 'category') {
        return xmlNode('wp:category', [
          xmlNode('wp:term_id', [String(termId)]),
          xmlNode('wp:category_nicename', [xmlRaw(cdata(term.slug))]),
          xmlNode('wp:category_parent', [xmlRaw(cdata(''))]),
          xmlNode('wp:cat_name', [xmlRaw(cdata(term.label))]),
        ])
      }

      return xmlNode('wp:tag', [
        xmlNode('wp:term_id', [String(termId)]),
        xmlNode('wp:tag_slug', [xmlRaw(cdata(term.slug))]),
        xmlNode('wp:tag_name', [xmlRaw(cdata(term.label))]),
      ])
    })
}

function renderWordPressItem(item: LoadedWordPressDatasetItem, datasetSlug: string, index: number): XmlNode {
  const baseSiteUrl = getBaseSiteUrl(datasetSlug)
  const link = `${baseSiteUrl}/${item.slug}/`
  const postDate = new Date(CHANNEL_PUB_DATE)

  postDate.setUTCDate(CHANNEL_PUB_DATE.getUTCDate() + index)

  return xmlNode('item', [
    xmlNode('title', [xmlRaw(cdata(item.title))]),
    xmlNode('link', [link]),
    xmlNode('pubDate', [formatPubDate(postDate)]),
    xmlNode('dc:creator', [xmlRaw(cdata(CHANNEL_AUTHOR_LOGIN))]),
    xmlNode('guid', [`${baseSiteUrl}/?p=${index + 1}`], { isPermaLink: 'false' }),
    xmlNode('description'),
    xmlNode('content:encoded', [xmlRaw(cdata(item.content))]),
    xmlNode('excerpt:encoded', [xmlRaw(cdata(item.excerpt))]),
    xmlNode('wp:post_id', [String(index + 1)]),
    xmlNode('wp:post_date', [formatWordPressDate(postDate)]),
    xmlNode('wp:post_date_gmt', [formatWordPressDate(postDate)]),
    xmlNode('wp:comment_status', [DEFAULT_COMMENT_STATUS]),
    xmlNode('wp:ping_status', [DEFAULT_PING_STATUS]),
    xmlNode('wp:post_name', [xmlRaw(cdata(item.slug))]),
    xmlNode('wp:status', [item.state === 'published' ? 'publish' : 'draft']),
    xmlNode('wp:post_parent', [String(DEFAULT_POST_PARENT)]),
    xmlNode('wp:menu_order', [String(DEFAULT_MENU_ORDER)]),
    xmlNode('wp:post_type', [item.type]),
    xmlNode('wp:post_password'),
    xmlNode('wp:is_sticky', ['0']),
    ...item.taxonomyTerms.map((term) =>
      xmlNode('category', [xmlRaw(cdata(term.label))], {
        domain: getWordPressTaxonomyName(term.type),
        nicename: term.slug,
      }),
    ),
  ])
}

function buildSmokeSpecification(dataset: LoadedWordPressDataset): WordPressSmokeSpecification {
  return {
    expectedItems: dataset.items.map((item) => {
      const taxonomyGroups = new Map<'category' | 'post_tag', string[]>()

      for (const term of item.taxonomyTerms) {
        const taxonomy = getWordPressTaxonomyName(term.type)
        const slugs = taxonomyGroups.get(taxonomy) ?? []

        slugs.push(term.slug)
        slugs.sort((left, right) => left.localeCompare(right))
        taxonomyGroups.set(taxonomy, slugs)
      }

      return {
        content: item.content,
        excerpt: item.excerpt,
        slug: item.slug,
        state: item.state,
        taxonomies: [...taxonomyGroups.entries()]
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([taxonomy, slugs]) => ({
            slugs,
            taxonomy,
          })),
        title: item.title,
        type: item.type,
      }
    }),
    siteOptions: {
      blogdescription: dataset.description,
      blogname: dataset.title,
    },
  }
}

function renderSmokeAssertionPhp(dataset: LoadedWordPressDataset): string {
  const specification = Buffer.from(JSON.stringify(buildSmokeSpecification(dataset))).toString('base64')

  return [
    '<?php',
    "require_once '/wordpress/wp-load.php';",
    `$spec = json_decode(base64_decode('${specification}'), true, 512, JSON_THROW_ON_ERROR);`,
    'function normalize_wordflow_value($value) {',
    '\treturn preg_replace("/\\r\\n?/", "\\n", trim((string) $value));',
    '}',
    'foreach ($spec["siteOptions"] as $optionName => $expectedValue) {',
    '\t$actualValue = get_option($optionName);',
    '\tif ((string) $actualValue !== (string) $expectedValue) {',
    '\t\tthrow new Exception("Unexpected site option " . $optionName . ".");',
    '\t}',
    '}',
    'foreach ($spec["expectedItems"] as $expectedItem) {',
    '\t$posts = get_posts([',
    '\t\t"name" => $expectedItem["slug"],',
    '\t\t"numberposts" => 2,',
    '\t\t"post_status" => "any",',
    '\t\t"post_type" => $expectedItem["type"],',
    '\t]);',
    '\tif (count($posts) !== 1) {',
    '\t\tthrow new Exception("Expected exactly one imported item for " . $expectedItem["type"] . " " . $expectedItem["slug"] . ".");',
    '\t}',
    '\t$post = $posts[0];',
    '\t$expectedStatus = $expectedItem["state"] === "published" ? "publish" : "draft";',
    '\tif ($post->post_status !== $expectedStatus) {',
    '\t\tthrow new Exception("Unexpected post status for " . $expectedItem["slug"] . ".");',
    '\t}',
    '\tif (normalize_wordflow_value($post->post_content) !== normalize_wordflow_value($expectedItem["content"])) {',
    '\t\tthrow new Exception("Unexpected post content for " . $expectedItem["slug"] . ".");',
    '\t}',
    '\tif (normalize_wordflow_value($post->post_excerpt) !== normalize_wordflow_value($expectedItem["excerpt"])) {',
    '\t\tthrow new Exception("Unexpected post excerpt for " . $expectedItem["slug"] . ".");',
    '\t}',
    '\tif ((string) $post->post_title !== (string) $expectedItem["title"]) {',
    '\t\tthrow new Exception("Unexpected post title for " . $expectedItem["slug"] . ".");',
    '\t}',
    '\tforeach ($expectedItem["taxonomies"] as $expectedTaxonomy) {',
    '\t\t$actualSlugs = wp_get_object_terms($post->ID, $expectedTaxonomy["taxonomy"], ["fields" => "slugs"]);',
    '\t\tif (is_wp_error($actualSlugs)) {',
    '\t\t\tthrow new Exception("Failed to resolve taxonomy terms for " . $expectedItem["slug"] . ".");',
    '\t\t}',
    '\t\tsort($actualSlugs);',
    '\t\t$expectedSlugs = $expectedTaxonomy["slugs"];',
    '\t\tsort($expectedSlugs);',
    '\t\tif ($actualSlugs !== $expectedSlugs) {',
    '\t\t\tthrow new Exception("Unexpected taxonomy assignments for " . $expectedItem["slug"] . ".");',
    '\t\t}',
    '\t}',
    '}',
  ].join('\n')
}

function renderSmokeImportPhp(): string {
  return [
    '<?php',
    "require_once '/wordpress/wp-load.php';",
    "if (!defined('WP_LOAD_IMPORTERS')) {",
    "\tdefine('WP_LOAD_IMPORTERS', true);",
    '}',
    "if (!defined('WP_IMPORTING')) {",
    "\tdefine('WP_IMPORTING', true);",
    '}',
    'wp_set_current_user(1);',
    "require_once ABSPATH . 'wp-admin/includes/post.php';",
    "require_once ABSPATH . 'wp-admin/includes/taxonomy.php';",
    "require_once WP_PLUGIN_DIR . '/wordpress-importer/wordpress-importer.php';",
    "if (!class_exists('WP_Import')) {",
    "\tthrow new Exception('WordPress importer class is unavailable.');",
    '}',
    '$importer = new WP_Import();',
    '$importer->fetch_attachments = false;',
    'ob_start();',
    `$importer->import('${EXPECTED_WXR_PLAYGROUND_PATH}', ['rewrite_urls' => false]);`,
    '$output = ob_get_clean();',
    "if (is_string($output) && str_contains($output, 'Sorry, there has been an error.')) {",
    "\tthrow new Exception('WordPress importer reported an error.');",
    '}',
  ].join('\n')
}

function renderSmokeBlueprint(dataset: LoadedWordPressDataset, wordpressVersion: string): string {
  return JSON.stringify(
    {
      $schema: CHANNEL_SCHEMA_URL,
      preferredVersions: {
        php: PREFERRED_PHP_VERSION,
        wp: wordpressVersion,
      },
      steps: [
        {
          options: {
            blogdescription: dataset.description,
            blogname: dataset.title,
          },
          step: 'setSiteOptions',
        },
        {
          data: {
            path: EXPECTED_WXR_FILENAME,
            resource: 'bundled',
          },
          path: EXPECTED_WXR_PLAYGROUND_PATH,
          step: 'writeFile',
        },
        {
          options: {
            activate: false,
            targetFolderName: 'wordpress-importer',
          },
          pluginData: {
            path: EXPECTED_WORDPRESS_IMPORTER_FILENAME,
            resource: 'bundled',
          },
          step: 'installPlugin',
        },
        {
          code: renderSmokeImportPhp(),
          step: 'runPHP',
        },
        {
          code: renderSmokeAssertionPhp(dataset),
          step: 'runPHP',
        },
      ],
    },
    null,
    2,
  )
}

export async function ensureWordPressSmokeAssets(): Promise<WordPressSmokeAssets> {
  const importerZipPath = join(WORDPRESS_CACHE_DIRECTORY_PATH, `wordpress-importer.${WORDPRESS_IMPORTER_VERSION}.zip`)
  const wordpressZipPath = join(WORDPRESS_CACHE_DIRECTORY_PATH, `wordpress-${WORDPRESS_CORE_VERSION}.zip`)
  const assetsToEnsure = [
    {
      filePath: importerZipPath,
      url: WORDPRESS_IMPORTER_RELEASE_URL,
    },
    {
      filePath: wordpressZipPath,
      url: WORDPRESS_CORE_RELEASE_URL,
    },
  ].sort((left, right) => left.filePath.localeCompare(right.filePath))

  await mkdir(WORDPRESS_CACHE_DIRECTORY_PATH, {
    recursive: true,
  })

  await Promise.all(
    assetsToEnsure.map(async ({ filePath, url }) => {
      try {
        await ensureFileExists(filePath)
      } catch {
        await downloadFile(url, filePath)
      }
    }),
  )

  return {
    importerZipPath,
    wordpressVersion: PREFERRED_WORDPRESS_VERSION,
    wordpressZipPath,
  }
}

export async function createWordPressSmokeBundle(
  datasetPath: string,
  outputDirectoryPath: string,
  options: CreateWordPressSmokeBundleOptions,
) {
  const dataset = await readValidatedDataset(datasetPath)
  const absoluteOutputDirectoryPath = resolve(outputDirectoryPath)
  const blueprintPath = join(absoluteOutputDirectoryPath, EXPECTED_BLUEPRINT_FILENAME)
  const wordpressImporterPath = join(absoluteOutputDirectoryPath, EXPECTED_WORDPRESS_IMPORTER_FILENAME)
  const wxrPath = join(absoluteOutputDirectoryPath, EXPECTED_WXR_FILENAME)

  await mkdir(absoluteOutputDirectoryPath, {
    recursive: true,
  })
  await Promise.all([
    copyFile(options.importerZipPath, wordpressImporterPath),
    writeFile(blueprintPath, `${renderSmokeBlueprint(dataset, options.wordpressVersion)}\n`),
    writeFile(wxrPath, await createWordPressWxr(datasetPath)),
  ])

  return {
    blueprintPath,
    wordpressImporterPath,
    wxrPath,
  }
}

export async function createWordPressWxr(datasetPath: string): Promise<string> {
  const dataset = await readValidatedDataset(datasetPath)
  const baseSiteUrl = getBaseSiteUrl(dataset.slug)
  const topLevelTerms = renderTopLevelTaxonomyTerms(dataset.items)
  const renderedItems = dataset.items.map((item, index) => renderWordPressItem(item, dataset.slug, index))

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    renderXmlNode(
      xmlNode(
        'rss',
        [
          xmlNode('channel', [
            xmlNode('title', [dataset.title]),
            xmlNode('link', [baseSiteUrl]),
            xmlNode('description', [dataset.description]),
            xmlNode('pubDate', [formatPubDate(CHANNEL_PUB_DATE)]),
            xmlNode('language', [getChannelLanguage(dataset.locale)]),
            xmlNode('wp:wxr_version', [CHANNEL_WXR_VERSION]),
            xmlNode('wp:base_site_url', [baseSiteUrl]),
            xmlNode('wp:base_blog_url', [baseSiteUrl]),
            xmlNode('wp:author', [
              xmlNode('wp:author_login', [xmlRaw(cdata(CHANNEL_AUTHOR_LOGIN))]),
              xmlNode('wp:author_email', [xmlRaw(cdata(CHANNEL_AUTHOR_EMAIL))]),
              xmlNode('wp:author_display_name', [xmlRaw(cdata(CHANNEL_AUTHOR_DISPLAY_NAME))]),
              xmlNode('wp:author_first_name', [xmlRaw(cdata('Wordflow'))]),
              xmlNode('wp:author_last_name', [xmlRaw(cdata('Dataset'))]),
            ]),
            ...topLevelTerms,
            ...renderedItems,
          ]),
        ],
        {
          version: '2.0',
          'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
          'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
          'xmlns:excerpt': 'https://wordpress.org/export/1.2/excerpt/',
          'xmlns:wfw': 'http://wellformedweb.org/CommentAPI/',
          'xmlns:wp': 'https://wordpress.org/export/1.2/',
        },
      ),
      0,
    ),
    '',
  ].join('\n')
}
