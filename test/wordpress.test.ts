import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createWordPressSmokeBundle, createWordPressWxr } from '../src/wordpress.ts'

const EDITORIAL_SAMPLE_PATH = resolve(import.meta.dir, '../datasets/editorial-sample')
const THEME_UNIT_TEST_PATH = resolve(import.meta.dir, '../datasets/theme-unit-test')
const temporaryRoots: string[] = []

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

test('createWordPressSmokeBundle writes a bundled blueprint and wxr export', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-wordpress-bundle-'))

  temporaryRoots.push(temporaryRoot)

  const { blueprintPath, wxrPath } = await createWordPressSmokeBundle(THEME_UNIT_TEST_PATH, temporaryRoot)
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8')) as {
    steps: Array<{
      file?: {
        path: string
        resource: string
      }
      step: string
    }>
  }
  const wxr = await readFile(wxrPath, 'utf8')

  expect(blueprint.steps.map((step) => step.step)).toEqual(['setSiteOptions', 'importWxr', 'runPHP'])
  expect(blueprint.steps[1]?.file).toEqual({
    path: 'dataset.wxr',
    resource: 'bundled',
  })
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

test('createWordPressWxr preserves WordPress block markup bodies', async () => {
  const wxr = await createWordPressWxr(THEME_UNIT_TEST_PATH)

  expect(wxr).toContain('<!-- wp:button {"align":"left"} -->')
  expect(wxr).toContain('<wp:post_name><![CDATA[block-button]]></wp:post_name>')
  expect(wxr).toContain('<wp:tag_name><![CDATA[content περιεχόμενο]]></wp:tag_name>')
})
