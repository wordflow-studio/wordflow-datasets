#!/usr/bin/env bun

import {
  applyDatasetToWordPress,
  createWordPressRestTransport,
  loadDataset,
  summarizeDataset,
  validateDataset,
} from './index.ts'

function printUsage(): void {
  console.log(`wordflow-dataset

Usage:
  wordflow-dataset validate <dataset-path-or-slug>
  wordflow-dataset apply <dataset-path-or-slug>
`)
}

function requireWordPressEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

async function runApply(input: string): Promise<void> {
  const dataset = await loadDataset(input)
  const transport = createWordPressRestTransport({
    baseUrl: requireWordPressEnv('WORDPRESS_ENDPOINT'),
    password: requireWordPressEnv('WORDPRESS_PASSWORD'),
    username: requireWordPressEnv('WORDPRESS_USERNAME'),
  })

  const result = await applyDatasetToWordPress(dataset, transport)
  console.log(
    JSON.stringify(
      {
        content: result.content.length,
        dataset: dataset.manifest.id,
        media: result.media.length,
        status: 'applied',
        terms: result.terms.length,
      },
      null,
      2,
    ),
  )
}

async function runValidate(input: string): Promise<void> {
  const dataset = await loadDataset(input)
  const validation = validateDataset(dataset)

  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`${error.path}: ${error.message}`)
    }

    throw new Error(`Dataset validation failed for ${dataset.manifest.id}`)
  }

  console.log(
    JSON.stringify(
      {
        dataset: dataset.manifest.id,
        status: 'valid',
        summary: summarizeDataset(dataset),
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const [command, input] = process.argv.slice(2)

  if (!command || !input) {
    printUsage()
    return
  }

  if (command === 'apply') {
    await runApply(input)
    return
  }

  if (command === 'validate') {
    await runValidate(input)
    return
  }

  printUsage()
  process.exitCode = 1
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  console.error(message)
  process.exitCode = 1
})
