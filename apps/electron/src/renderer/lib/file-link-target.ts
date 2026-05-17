export function normalizeLocalFileTarget(target: string): string {
  if (!/^file:/i.test(target)) return target

  try {
    const parsed = new URL(target)
    if (parsed.protocol !== 'file:') return target

    const pathname = decodeURIComponent(parsed.pathname || '')
    if (!pathname && !parsed.hostname) return target

    if (parsed.hostname) {
      return `//${decodeURIComponent(parsed.hostname)}${pathname}`
    }

    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
  } catch {
    return target
  }
}
