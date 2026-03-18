const assetPattern = /\{\{asset:([a-z0-9-]+)\}\}/g

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isOrderedListItem(line: string): boolean {
  return /^\d+\.\s+/.test(line)
}

function isUnorderedListItem(line: string): boolean {
  return /^-\s+/.test(line)
}

function renderParagraph(lines: string[]): string[] {
  if (lines.length === 0) {
    return []
  }

  return [`<p>${lines.map((line) => escapeHtml(line)).join(' ')}</p>`]
}

function replaceAssetPlaceholders(value: string, renderAssetHtml: (assetId: string) => string): string {
  return value.replaceAll(assetPattern, (_, assetId: string) => renderAssetHtml(assetId))
}

export function collectAssetPlaceholderIds(value: string): string[] {
  const assetIds = new Set<string>()

  for (const match of value.matchAll(assetPattern)) {
    assetIds.add(match[1] ?? '')
  }

  return [...assetIds].filter(Boolean).sort()
}

export function renderBodyToHtml(
  body: string,
  bodyFormat: 'html' | 'markdown',
  renderAssetHtml: (assetId: string) => string,
): string {
  if (bodyFormat === 'html') {
    return replaceAssetPlaceholders(body, renderAssetHtml)
  }

  const html: string[] = []
  const paragraph: string[] = []
  let listKind: 'ol' | 'ul' | undefined

  const closeList = () => {
    if (!listKind) {
      return
    }

    html.push(`</${listKind}>`)
    listKind = undefined
  }

  const flushParagraph = () => {
    html.push(...renderParagraph(paragraph))
    paragraph.length = 0
  }

  const lines = replaceAssetPlaceholders(body, renderAssetHtml).split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      closeList()
      continue
    }

    if (line.startsWith('<') && line.endsWith('>')) {
      flushParagraph()
      closeList()
      html.push(line)
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      closeList()
      const depth = headingMatch[1]?.length ?? 1
      const headingText = headingMatch[2] ?? ''
      html.push(`<h${depth}>${escapeHtml(headingText)}</h${depth}>`)
      continue
    }

    if (isUnorderedListItem(line) || isOrderedListItem(line)) {
      flushParagraph()
      const nextListKind = isOrderedListItem(line) ? 'ol' : 'ul'
      if (listKind !== nextListKind) {
        closeList()
        html.push(`<${nextListKind}>`)
        listKind = nextListKind
      }

      const item = line.replace(/^(?:\d+\.|-)\s+/, '')
      html.push(`<li>${escapeHtml(item)}</li>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  flushParagraph()
  closeList()

  return html.join('\n')
}
