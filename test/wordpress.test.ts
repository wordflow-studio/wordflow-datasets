import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createWordPressSmokeBundle, createWordPressWxr } from '../src/wordpress.ts'

const EDITORIAL_SAMPLE_PATH = resolve(import.meta.dir, '../datasets/editorial-sample')
const THEME_UNIT_TEST_PATH = resolve(import.meta.dir, '../datasets/theme-unit-test')
const temporaryRoots: string[] = []

interface WordPressSmokeBundleBlueprint {
  steps: Array<{
    code?: string
    file?: {
      path: string
      resource: string
    }
    options?: {
      activate?: boolean
      targetFolderName?: string
    }
    path?: string
    pluginData?: {
      path: string
      resource: string
    }
    data?: {
      path: string
      resource: string
    }
    step: string
  }>
}

interface WordPressSmokeSpecification {
  expectedItems: Array<{
    content: string
    excerpt: string
    slug: string
  }>
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((temporaryRoot) =>
      rm(temporaryRoot, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

function escapeForRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractItemXml(wxr: string, slug: string): string {
  const itemXml = (wxr.match(/<item>[\s\S]*?<\/item>/g) ?? []).find((candidate) =>
    candidate.includes(`<wp:post_name><![CDATA[${slug}]]></wp:post_name>`),
  )

  if (!itemXml) {
    throw new Error(`Unable to find WXR item for slug "${slug}".`)
  }

  return itemXml
}

function extractSmokeSpecification(blueprint: WordPressSmokeBundleBlueprint): WordPressSmokeSpecification {
  const code = blueprint.steps.find(
    (step) => step.step === 'runPHP' && typeof step.code === 'string' && step.code.includes('base64_decode'),
  )?.code

  if (!code) {
    throw new Error('Unable to find smoke assertion code.')
  }

  const specificationMatch = code.match(/base64_decode\('([^']+)'\)/)

  if (!specificationMatch) {
    throw new Error('Unable to find smoke specification payload.')
  }

  const [, specificationBase64] = specificationMatch

  if (specificationBase64 === undefined) {
    throw new Error('Unable to decode smoke specification payload.')
  }

  return JSON.parse(Buffer.from(specificationBase64, 'base64').toString('utf8')) as WordPressSmokeSpecification
}

function extractWxrCdataValue(itemXml: string, tagName: 'content:encoded' | 'excerpt:encoded'): string {
  const tagPattern = new RegExp(
    `<${escapeForRegex(tagName)}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapeForRegex(tagName)}>`,
  )
  const valueMatch = itemXml.match(tagPattern)

  if (!valueMatch) {
    throw new Error(`Unable to find ${tagName} payload.`)
  }

  const [, value] = valueMatch

  if (value === undefined) {
    throw new Error(`Unable to decode ${tagName} payload.`)
  }

  return value
}

test('createWordPressSmokeBundle writes a bundled blueprint and wxr export', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-wordpress-bundle-'))
  const importerZipPath = join(temporaryRoot, 'fake-wordpress-importer.zip')

  temporaryRoots.push(temporaryRoot)
  await writeFile(importerZipPath, 'fake-importer-zip')

  const { blueprintPath, wordpressImporterPath, wxrPath } = await createWordPressSmokeBundle(
    THEME_UNIT_TEST_PATH,
    temporaryRoot,
    {
      importerZipPath,
      wordpressVersion: '6.9.4',
    },
  )
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8')) as WordPressSmokeBundleBlueprint
  const bundledImporterZip = await readFile(wordpressImporterPath, 'utf8')
  const wxr = await readFile(wxrPath, 'utf8')

  expect(blueprint.steps.map((step) => step.step)).toEqual([
    'setSiteOptions',
    'writeFile',
    'installPlugin',
    'runPHP',
    'runPHP',
  ])
  expect(blueprint.steps[1]?.data).toEqual({
    path: 'dataset.wxr',
    resource: 'bundled',
  })
  expect(blueprint.steps[1]?.path).toBe('/tmp/wordflow-dataset.wxr')
  expect(blueprint.steps[2]?.pluginData).toEqual({
    path: 'wordpress-importer.zip',
    resource: 'bundled',
  })
  expect(blueprint.steps[2]?.options).toEqual({
    activate: false,
    targetFolderName: 'wordpress-importer',
  })
  expect(bundledImporterZip).toBe('fake-importer-zip')
  expect(wxr).toContain('<wp:post_name><![CDATA[block-button]]></wp:post_name>')
})

test('createWordPressWxr maps markdown bodies into WordPress post content', async () => {
  const wxr = await createWordPressWxr(EDITORIAL_SAMPLE_PATH)

  expect(wxr).toContain('<h1>Welcome to Wordflow</h1>')
  expect(wxr).toContain(
    '<p>Wordflow helps teams launch believable seeded sites without hand-connecting every content record.</p>',
  )
  expect(wxr).toContain('<category domain="category" nicename="company-news"><![CDATA[Company News]]></category>')
  expect(wxr).toContain('<category domain="post_tag" nicename="platform"><![CDATA[Platform]]></category>')
})

test('createWordPressSmokeBundle preserves exact multiline content payloads in WXR items', async () => {
  for (const datasetPath of [EDITORIAL_SAMPLE_PATH, THEME_UNIT_TEST_PATH]) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-wordpress-bundle-'))
    const importerZipPath = join(temporaryRoot, 'fake-wordpress-importer.zip')

    temporaryRoots.push(temporaryRoot)
    await writeFile(importerZipPath, 'fake-importer-zip')

    const { blueprintPath, wxrPath } = await createWordPressSmokeBundle(datasetPath, temporaryRoot, {
      importerZipPath,
      wordpressVersion: '6.9.4',
    })
    const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8')) as WordPressSmokeBundleBlueprint
    const specification = extractSmokeSpecification(blueprint)
    const wxr = await readFile(wxrPath, 'utf8')

    for (const expectedItem of specification.expectedItems) {
      const itemXml = extractItemXml(wxr, expectedItem.slug)

      expect(extractWxrCdataValue(itemXml, 'content:encoded')).toEqual(expectedItem.content)
      expect(extractWxrCdataValue(itemXml, 'excerpt:encoded')).toEqual(expectedItem.excerpt)
    }
  }
})

test('createWordPressWxr preserves WordPress block markup bodies', async () => {
  const wxr = await createWordPressWxr(THEME_UNIT_TEST_PATH)

  expect(wxr).toContain('<!-- wp:button {"align":"left"} -->')
  expect(wxr).toContain('<wp:post_name><![CDATA[block-button]]></wp:post_name>')
  expect(wxr).toContain('<wp:tag_name><![CDATA[content περιεχόμενο]]></wp:tag_name>')
})
