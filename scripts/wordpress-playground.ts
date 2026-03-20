#!/usr/bin/env bun

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { argv, env, exitCode } from 'node:process'
import { createWordPressSmokeBundle, ensureWordPressSmokeAssets } from '../src/wordpress.ts'
import { getWordPressPreInstallArgs, unzipWordPress } from './wordpress-helpers.ts'

const DEFAULT_DATASET_PATH = 'datasets/editorial-sample'
const EXIT_FAILURE = 1
const EXIT_SUCCESS = 0
const EXPECTED_INTERRUPT_EXIT_CODES = new Set([EXIT_SUCCESS, 130, 143])
const READY_MARKER = 'WordPress is running on'

function getBrowserOpenCommand(url: string) {
  switch (process.platform) {
    case 'darwin':
      return ['open', url]
    case 'win32':
      return ['cmd', '/c', 'start', '', url]
    default:
      return ['xdg-open', url]
  }
}

async function forwardStream(
  stream: ReadableStream<Uint8Array>,
  writer: NodeJS.WriteStream,
  onText?: (text: string) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        const text = decoder.decode()

        if (text) {
          writer.write(text)
          onText?.(text)
        }

        return
      }

      const text = decoder.decode(value, { stream: true })

      if (text) {
        writer.write(text)
        onText?.(text)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function main() {
  const datasetArgument = argv[2] ?? DEFAULT_DATASET_PATH
  const datasetPath = resolve(datasetArgument)
  const repoRoot = resolve(import.meta.dir, '..')
  const cliPath = join(repoRoot, 'node_modules/.bin/wp-playground-cli')
  const port = env.WORDFLOW_PLAYGROUND_PORT ?? '9400'
  const siteUrl = `http://127.0.0.1:${port}`
  const shouldSkipBrowser = env.WORDFLOW_PLAYGROUND_SKIP_BROWSER === '1'
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'wordflow-dataset-playground-'))
  let childProcess: Bun.Subprocess | undefined
  let receivedSignal: NodeJS.Signals | undefined
  let shouldCleanup = true
  const handleSignal = (signal: NodeJS.Signals) => {
    receivedSignal = signal
    childProcess?.kill(signal)
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  try {
    const assets = await ensureWordPressSmokeAssets()
    const wordpressPath = await unzipWordPress(assets.wordpressZipPath, temporaryRoot)
    const { blueprintPath } = await createWordPressSmokeBundle(datasetPath, temporaryRoot, {
      importerZipPath: assets.importerZipPath,
      wordpressVersion: assets.wordpressVersion,
    })
    const command = [
      cliPath,
      'server',
      '--blueprint',
      blueprintPath,
      '--blueprint-may-read-adjacent-files',
      '--login',
      ...getWordPressPreInstallArgs(wordpressPath),
      '--port',
      port,
    ]

    console.log(`Starting interactive Playground for ${basename(datasetPath)} on port ${port}.`)
    console.log(`Temporary files are stored at ${temporaryRoot}.`)
    console.log(`Site URL: ${siteUrl}`)

    let readyOutput = ''
    let resolveReady: (() => void) | undefined
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    childProcess = Bun.spawn({
      cmd: command,
      cwd: repoRoot,
      stderr: 'pipe',
      stdin: 'inherit',
      stdout: 'pipe',
    })

    const stdout = childProcess.stdout as ReadableStream<Uint8Array>
    const stderr = childProcess.stderr as ReadableStream<Uint8Array>
    const stdoutTask = forwardStream(stdout, process.stdout, (text) => {
      if (resolveReady === undefined) {
        return
      }

      readyOutput = `${readyOutput}${text}`.slice(-READY_MARKER.length * 4)

      if (readyOutput.includes(READY_MARKER)) {
        resolveReady()
        resolveReady = undefined
      }
    })
    const stderrTask = forwardStream(stderr, process.stderr)

    if (!shouldSkipBrowser) {
      const readyResult = await Promise.race([
        readyPromise.then(() => 'ready' as const),
        childProcess.exited.then((code) => ({ code })),
      ])

      if (readyResult === 'ready') {
        try {
          const browserProcess = Bun.spawn({
            cmd: getBrowserOpenCommand(siteUrl),
            stderr: 'ignore',
            stdout: 'ignore',
          })
          const browserExitCode = await browserProcess.exited

          if (browserExitCode !== EXIT_SUCCESS) {
            console.error(`Warning: failed to open a browser automatically. Visit ${siteUrl} manually.`)
          }
        } catch {
          console.error(`Warning: failed to open a browser automatically. Visit ${siteUrl} manually.`)
        }
      }
    }

    const childExitCode = await childProcess.exited

    await Promise.all([stdoutTask, stderrTask])

    if (!receivedSignal && !EXPECTED_INTERRUPT_EXIT_CODES.has(childExitCode)) {
      shouldCleanup = false
      throw new Error(`WordPress Playground failed for ${basename(datasetPath)}.`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WordPress Playground error.'

    console.error(message)

    if (!shouldCleanup) {
      console.error(`Temporary bundle preserved at ${temporaryRoot}`)
    }

    process.exitCode = EXIT_FAILURE
    return
  } finally {
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)

    if (shouldCleanup) {
      await rm(temporaryRoot, {
        force: true,
        recursive: true,
      })
    }

    if (receivedSignal) {
      process.exitCode = EXIT_SUCCESS
    }
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown WordPress Playground error.'

  console.error(message)
  process.exitCode = EXIT_FAILURE
})

if (exitCode === undefined) {
  process.exitCode = EXIT_SUCCESS
}
