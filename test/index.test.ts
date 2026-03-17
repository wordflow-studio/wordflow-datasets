import { afterEach, expect, test } from 'bun:test'
import { chmod, cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { validateDataset } from '../src/index.ts'

const FIXTURE_PATH = resolve(import.meta.dir, '../datasets/editorial-sample')
const REPO_ROOT = resolve(import.meta.dir, '..')
const SHOULD_SKIP_PERMISSION_TESTS = process.platform === 'win32' || process.getuid?.() === 0
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

async function cloneFixture(): Promise<string> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-'))
  const datasetPath = join(temporaryRoot, 'editorial-sample')

  await cp(FIXTURE_PATH, datasetPath, {
    recursive: true,
  })

  temporaryRoots.push(temporaryRoot)

  return datasetPath
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, 'utf8')
  return JSON.parse(contents) as T
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

test('validateDataset accepts the curated editorial sample', async () => {
  const report = await validateDataset(FIXTURE_PATH)

  expect(report.errorCount).toBe(0)
  expect(report.itemCount).toBe(2)
  expect(report.status).toBe('valid')
  expect(report.valid).toBe(true)
  expect(report.warningCount).toBe(0)
})

test('validateDataset reports a missing dataset manifest', async () => {
  const datasetPath = await cloneFixture()

  await unlink(join(datasetPath, 'dataset.json'))

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('missing-file')
  expect(report.errors.map((error) => error.path)).toContain('dataset.json')
})

test('validateDataset reports a missing body file', async () => {
  const datasetPath = await cloneFixture()

  await unlink(join(datasetPath, 'content/post/company-update/body.md'))

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('missing-file')
  expect(report.errors.map((error) => error.path)).toContain('content/post/company-update/body.md')
})

test('validateDataset rejects unsupported schema versions', async () => {
  const datasetPath = await cloneFixture()
  const manifest = await readJsonFile<Record<string, unknown>>(join(datasetPath, 'dataset.json'))

  manifest.schemaVersion = '2.0.0'
  await writeJsonFile(join(datasetPath, 'dataset.json'), manifest)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('unsupported-schema-version')
})

test('validateDataset rejects unknown fields that are outside the published schema', async () => {
  const datasetPath = await cloneFixture()
  const manifest = await readJsonFile<Record<string, unknown>>(join(datasetPath, 'dataset.json'))

  manifest.unexpectedField = 'extra'
  await writeJsonFile(join(datasetPath, 'dataset.json'), manifest)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('unknown-field')
  expect(report.errors.map((error) => error.path)).toContain('dataset.json.unexpectedField')
})

test('validateDataset rejects unresolved taxonomy and source references', async () => {
  const datasetPath = await cloneFixture()
  const itemPath = join(datasetPath, 'content/post/company-update/item.json')
  const item = await readJsonFile<Record<string, unknown>>(itemPath)

  item.sourceRefs = ['missing-source']
  item.taxonomyRefs = ['category:missing-term']
  await writeJsonFile(itemPath, item)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('unknown-source-ref')
  expect(report.errors.map((error) => error.code)).toContain('unknown-taxonomy-ref')
})

test('validateDataset rejects duplicate content slugs within the same type and locale', async () => {
  const datasetPath = await cloneFixture()
  const duplicatePath = join(datasetPath, 'content/post/company-update-copy')

  await cp(join(datasetPath, 'content/post/company-update'), duplicatePath, {
    recursive: true,
  })

  const duplicateItemPath = join(duplicatePath, 'item.json')
  const duplicateItem = await readJsonFile<Record<string, unknown>>(duplicateItemPath)

  duplicateItem.slug = 'company-update'
  await writeJsonFile(duplicateItemPath, duplicateItem)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('duplicate-item-slug')
})

test('validateDataset reports a missing content directory once', async () => {
  const datasetPath = await cloneFixture()

  await rm(join(datasetPath, 'content'), {
    force: true,
    recursive: true,
  })

  const report = await validateDataset(datasetPath)
  const missingContentDirectoryErrors = report.errors.filter(
    (error) => error.code === 'missing-directory' && error.path === 'content',
  )

  expect(report.status).toBe('invalid')
  expect(missingContentDirectoryErrors).toHaveLength(1)
})

test('validateDataset rejects a content directory that resolves outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const externalContentPath = join(dirname(datasetPath), 'external-content')

  await cp(join(datasetPath, 'content'), externalContentPath, {
    recursive: true,
  })
  await rm(join(datasetPath, 'content'), {
    force: true,
    recursive: true,
  })
  await symlink(externalContentPath, join(datasetPath, 'content'))

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-directory-path')
  expect(report.errors.map((error) => error.path)).toContain('content')
})

test('validateDataset rejects an assets directory that resolves outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const externalAssetsPath = join(dirname(datasetPath), 'external-assets')

  await cp(join(datasetPath, 'assets'), externalAssetsPath, {
    recursive: true,
  })
  await rm(join(datasetPath, 'assets'), {
    force: true,
    recursive: true,
  })
  await symlink(externalAssetsPath, join(datasetPath, 'assets'))

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-directory-path')
  expect(report.errors.map((error) => error.path)).toContain('assets')
})

test('validateDataset rejects README files that resolve outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const externalReadmePath = join(dirname(datasetPath), 'external-README.md')
  const readmePath = join(datasetPath, 'README.md')

  await writeFile(externalReadmePath, await readFile(readmePath, 'utf8'))
  await unlink(readmePath)
  await symlink(externalReadmePath, readmePath)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-file-path')
  expect(report.errors.map((error) => error.path)).toContain('README.md')
})

test('validateDataset rejects missing featured assets', async () => {
  const datasetPath = await cloneFixture()
  const itemPath = join(datasetPath, 'content/post/company-update/item.json')
  const item = await readJsonFile<Record<string, unknown>>(itemPath)

  item.featuredAsset = 'assets/missing.png'
  await writeJsonFile(itemPath, item)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('missing-featured-asset')
})

test('validateDataset rejects featured assets that resolve outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const itemPath = join(datasetPath, 'content/post/company-update/item.json')
  const item = await readJsonFile<Record<string, unknown>>(itemPath)
  const externalAssetPath = join(dirname(datasetPath), 'external-asset.txt')
  const symlinkPath = join(datasetPath, 'assets/external-asset.txt')

  await writeFile(externalAssetPath, 'outside dataset\n')
  await symlink(externalAssetPath, symlinkPath)

  item.featuredAsset = 'assets/external-asset.txt'
  await writeJsonFile(itemPath, item)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-asset-path')
})

test('validateDataset rejects body files that resolve outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const bodyPath = join(datasetPath, 'content/post/company-update/body.md')
  const externalBodyPath = join(dirname(datasetPath), 'external-body.md')

  await writeFile(externalBodyPath, await readFile(bodyPath, 'utf8'))
  await unlink(bodyPath)
  await symlink(externalBodyPath, bodyPath)

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-file-path')
  expect(report.errors.map((error) => error.path)).toContain('content/post/company-update/body.md')
})

test('validateDataset rejects JSON files that resolve outside the dataset via symlink', async () => {
  const datasetPath = await cloneFixture()
  const externalDatasetPath = join(dirname(datasetPath), 'external-dataset.json')

  await writeFile(externalDatasetPath, await readFile(join(datasetPath, 'dataset.json'), 'utf8'))
  await unlink(join(datasetPath, 'dataset.json'))
  await symlink(externalDatasetPath, join(datasetPath, 'dataset.json'))

  const report = await validateDataset(datasetPath)

  expect(report.status).toBe('invalid')
  expect(report.errors.map((error) => error.code)).toContain('invalid-file-path')
  expect(report.errors.map((error) => error.path)).toContain('dataset.json')
})

test('validateDataset reports unreadable status for unreadable manifests', async () => {
  if (SHOULD_SKIP_PERMISSION_TESTS) {
    return
  }

  const datasetPath = await cloneFixture()
  const manifestPath = join(datasetPath, 'dataset.json')

  await chmod(manifestPath, 0o000)

  try {
    const report = await validateDataset(datasetPath)

    expect(report.status).toBe('unreadable')
    expect(report.errors.map((error) => error.code)).toContain('unreadable-file')
    expect(report.errors.map((error) => error.path)).toContain('dataset.json')
  } finally {
    await chmod(manifestPath, 0o644)
  }
})

test('validateDataset reports unreadable status for unreadable README files', async () => {
  if (SHOULD_SKIP_PERMISSION_TESTS) {
    return
  }

  const datasetPath = await cloneFixture()
  const readmePath = join(datasetPath, 'README.md')

  await chmod(readmePath, 0o000)

  try {
    const report = await validateDataset(datasetPath)

    expect(report.status).toBe('unreadable')
    expect(report.errors.map((error) => error.code)).toContain('unreadable-file')
    expect(report.errors.map((error) => error.path)).toContain('README.md')
  } finally {
    await chmod(readmePath, 0o644)
  }
})

test('validateDataset reports unreadable status for unreadable body files', async () => {
  if (SHOULD_SKIP_PERMISSION_TESTS) {
    return
  }

  const datasetPath = await cloneFixture()
  const bodyPath = join(datasetPath, 'content/post/company-update/body.md')

  await chmod(bodyPath, 0o000)

  try {
    const report = await validateDataset(datasetPath)

    expect(report.status).toBe('unreadable')
    expect(report.errors.map((error) => error.code)).toContain('unreadable-file')
    expect(report.errors.map((error) => error.path)).toContain('content/post/company-update/body.md')
  } finally {
    await chmod(bodyPath, 0o644)
  }
})

test('validateDataset reports unreadable status when content cannot be listed', async () => {
  if (SHOULD_SKIP_PERMISSION_TESTS) {
    return
  }

  const datasetPath = await cloneFixture()
  const contentPath = join(datasetPath, 'content')

  await chmod(contentPath, 0o000)

  try {
    const report = await validateDataset(datasetPath)

    expect(report.status).toBe('unreadable')
    expect(report.errors.map((error) => error.code)).toContain('unreadable-directory')
    expect(report.errors.map((error) => error.path)).toContain('content')
  } finally {
    await chmod(contentPath, 0o755)
  }
})

test('the CLI uses stable exit codes for valid, invalid, and unreadable input', async () => {
  const invalidDatasetPath = await cloneFixture()

  await unlink(join(invalidDatasetPath, 'dataset.json'))

  const invalidRun = Bun.spawnSync({
    cmd: [process.execPath, 'src/cli.ts', 'validate', invalidDatasetPath],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const unreadableRun = Bun.spawnSync({
    cmd: [process.execPath, 'src/cli.ts', 'validate', join(REPO_ROOT, 'datasets/missing-dataset')],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const validRun = Bun.spawnSync({
    cmd: [process.execPath, 'src/cli.ts', 'validate', FIXTURE_PATH],
    cwd: REPO_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  })

  expect(validRun.exitCode).toBe(0)
  expect(new TextDecoder().decode(validRun.stdout)).toContain('Status: valid')
  expect(invalidRun.exitCode).toBe(1)
  expect(new TextDecoder().decode(invalidRun.stdout)).toContain('Status: invalid')
  expect(unreadableRun.exitCode).toBe(2)
  expect(new TextDecoder().decode(unreadableRun.stdout)).toContain('Status: unreadable')
})
