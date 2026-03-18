#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { argv, env, exitCode } from 'node:process'
import { createWordPressSmokeBundle } from '../src/wordpress.ts'

const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0

async function main() {
  const datasetArgument = argv[2]

  if (!datasetArgument) {
    console.error('Usage: bun run ./scripts/wordpress-apply-smoke.ts <dataset-path>')
    process.exitCode = EXIT_FAILURE
    return
  }

  const datasetPath = resolve(datasetArgument)
  const repoRoot = resolve(import.meta.dir, '..')
  const cliPath = join(repoRoot, 'node_modules/.bin/wp-playground-cli')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-wordpress-'))
  const verbosity = env.WORDFLOW_PLAYGROUND_VERBOSITY ?? 'normal'
  let shouldCleanup = true

  try {
    const { blueprintPath } = await createWordPressSmokeBundle(datasetPath, temporaryRoot)
    const childProcess = Bun.spawn({
      cmd: [
        cliPath,
        'run-blueprint',
        '--blueprint',
        blueprintPath,
        '--blueprint-may-read-adjacent-files',
        '--verbosity',
        verbosity,
      ],
      cwd: repoRoot,
      stderr: 'inherit',
      stdout: 'inherit',
    })
    const childExitCode = await childProcess.exited

    if (childExitCode !== EXIT_SUCCESS) {
      shouldCleanup = false
      throw new Error(`WordPress smoke harness failed for ${basename(datasetPath)}.`)
    }

    console.log(`WordPress smoke harness passed for ${basename(datasetPath)}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WordPress smoke harness error.'

    console.error(message)

    if (!shouldCleanup) {
      console.error(`Temporary bundle preserved at ${temporaryRoot}`)
    }

    process.exitCode = EXIT_FAILURE
    return
  } finally {
    if (shouldCleanup) {
      await rm(temporaryRoot, {
        force: true,
        recursive: true,
      })
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown WordPress smoke harness error.'

  console.error(message)
  process.exitCode = EXIT_FAILURE
})

if (exitCode === undefined) {
  process.exitCode = EXIT_SUCCESS
}
