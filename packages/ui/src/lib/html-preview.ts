/**
 * Shared helpers for HTML preview surfaces.
 *
 * Security model:
 * - Static HTML previews run in sandboxed iframes without script execution.
 * - JS-driven HTML should be opened in the dedicated browser surface instead of
 *   trying to execute inside the app renderer.
 */

const SCRIPT_TAG_PATTERN = /<script\b/i

/**
 * Inject a base href for file-backed previews so relative stylesheets, images,
 * and links resolve next to the source HTML file.
 */
export function injectHtmlPreviewBase(html: string, sourcePath?: string): string {
  const baseHref = getHtmlPreviewBaseHref(sourcePath)
  if (!baseHref || /<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1<base href="${baseHref}">`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head><base href="${baseHref}"></head>`)
  }
  return `<head><base href="${baseHref}"></head>${html}`
}

export function getHtmlPreviewBaseHref(sourcePath?: string): string | null {
  if (!sourcePath) return null

  if (/^file:/i.test(sourcePath)) {
    try {
      const parsed = new URL(sourcePath)
      parsed.search = ''
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/[^/]*$/, '')
      return parsed.toString()
    } catch {
      return null
    }
  }

  const normalized = sourcePath.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex === -1) return null

  const directory = normalized.slice(0, slashIndex + 1)
  const encoded = encodeURI(directory)

  if (/^[A-Za-z]:\//.test(directory)) {
    return `file:///${encoded}`
  }

  if (directory.startsWith('/')) {
    return `file://${encoded}`
  }

  return null
}

/**
 * Heuristic: pages with scripts usually need a real browser runtime and will
 * appear blank in the static sandbox preview.
 */
export function htmlRequiresBrowserRuntime(html: string): boolean {
  return SCRIPT_TAG_PATTERN.test(html)
}
