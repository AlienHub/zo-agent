import { defaultUrlTransform, type UrlTransform } from 'react-markdown'

/**
 * Preserve local file links so the app can intercept and open them in-place.
 * Other protocols should continue to flow through react-markdown's sanitizer.
 */
export const preserveFileUrlTransform: UrlTransform = (url, key, node) => {
  if (/^file:/i.test(url)) {
    return url
  }

  return defaultUrlTransform(url)
}
