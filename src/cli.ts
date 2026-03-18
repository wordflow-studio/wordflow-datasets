#!/usr/bin/env bun

import { basename, resolve } from 'node:path'
import { Command, CommanderError } from 'commander'
import { validateDataset } from './index.ts'
import type { ValidationIssue, ValidationReport } from './types.ts'

const EXIT_INVALID_DATASET = 1
const EXIT_SUCCESS = 0
const EXIT_USAGE_OR_UNREADABLE = 2

function formatIssue(issue: ValidationIssue): string {
  return `- [${issue.code}] ${issue.path}: ${issue.message}`
}

function printReport(report: ValidationReport) {
  const lines = [`Dataset: ${report.datasetPath}`, `Items: ${report.itemCount}`, `Status: ${report.status}`]

  if (report.errorCount > 0) {
    lines.push(`Errors (${report.errorCount}):`)
    lines.push(...report.errors.map(formatIssue))
  }

  if (report.warningCount > 0) {
    lines.push(`Warnings (${report.warningCount}):`)
    lines.push(...report.warnings.map(formatIssue))
  }

  console.log(lines.join('\n'))
}

function mapReportToExitCode(report: ValidationReport): number {
  if (report.status === 'valid') {
    return EXIT_SUCCESS
  }

  if (report.status === 'unreadable') {
    return EXIT_USAGE_OR_UNREADABLE
  }

  return EXIT_INVALID_DATASET
}

function createProgram(): Command {
  const program = new Command()

  program
    .name(basename(process.argv[1] ?? 'wordflow-dataset'))
    .description('Validate portable Wordflow dataset directories.')
    .showHelpAfterError()

  program
    .command('validate')
    .description('Validate a dataset directory against the v1 contract.')
    .argument('<dataset-path>', 'Path to the dataset directory.')
    .action(async (datasetPath: string) => {
      const report = await validateDataset(resolve(datasetPath))
      printReport(report)
      process.exitCode = mapReportToExitCode(report)
    })

  program.addHelpText(
    'afterAll',
    [
      '',
      'Exit codes:',
      `  ${EXIT_SUCCESS} valid dataset`,
      `  ${EXIT_INVALID_DATASET} invalid dataset`,
      `  ${EXIT_USAGE_OR_UNREADABLE} usage or unreadable input`,
    ].join('\n'),
  )

  program.exitOverride()

  return program
}

async function main(argv: string[]) {
  const program = createProgram()

  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.help' ||
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version'
      ) {
        process.exitCode = EXIT_SUCCESS
        return
      }

      process.exitCode = EXIT_USAGE_OR_UNREADABLE
      return
    }

    throw error
  }
}

void main(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown CLI error.'

  console.error(message)
  process.exitCode = EXIT_USAGE_OR_UNREADABLE
})
