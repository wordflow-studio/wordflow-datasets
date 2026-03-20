import { access } from 'node:fs/promises'
import { join } from 'node:path'

const EXIT_SUCCESS = 0
const WORDPRESS_INSTALL_MODE = 'install-from-existing-files'
const WORDPRESS_VFS_PATH = '/wordpress'

export function getWordPressPreInstallArgs(wordpressPath: string) {
  return [
    '--mount-dir-before-install',
    wordpressPath,
    WORDPRESS_VFS_PATH,
    '--wordpress-install-mode',
    WORDPRESS_INSTALL_MODE,
  ] as const
}

export async function unzipWordPress(zipPath: string, destinationPath: string) {
  const unzipProcess = Bun.spawn({
    cmd: ['unzip', '-q', '-o', zipPath, '-d', destinationPath],
    stderr: 'inherit',
    stdout: 'inherit',
  })
  const unzipExitCode = await unzipProcess.exited

  if (unzipExitCode !== EXIT_SUCCESS) {
    throw new Error(`Failed to unzip cached WordPress core from ${zipPath}.`)
  }

  const extractedWordPressPath = join(destinationPath, 'wordpress')

  await access(extractedWordPressPath)

  return extractedWordPressPath
}
