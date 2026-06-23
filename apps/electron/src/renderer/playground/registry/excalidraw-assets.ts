declare const __EXCALIDRAW_DEV_ASSET_PATH__: string

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = __EXCALIDRAW_DEV_ASSET_PATH__

const EXCALIDRAW_FALLBACK_ASSET_PREFIX = 'https://esm.sh/@excalidraw/excalidraw'

function withoutRemoteExcalidrawFallback(source: string | BufferSource) {
  if (typeof source !== 'string' || !source.includes(EXCALIDRAW_FALLBACK_ASSET_PREFIX)) {
    return source
  }

  const localSources = source
    .split(/,\s*(?=url\()/)
    .filter(part => !part.includes(EXCALIDRAW_FALLBACK_ASSET_PREFIX))
    .join(', ')

  return localSources || source
}

const OriginalFontFace = window.FontFace

if (OriginalFontFace && !(OriginalFontFace as typeof FontFace & { __caExcalidrawAssetPatch?: boolean }).__caExcalidrawAssetPatch) {
  const PatchedFontFace = function FontFaceWithoutExcalidrawRemoteFallback(
    family: string,
    source: string | BufferSource,
    descriptors?: FontFaceDescriptors,
  ) {
    return new OriginalFontFace(family, withoutRemoteExcalidrawFallback(source), descriptors)
  } as unknown as typeof FontFace & { __caExcalidrawAssetPatch?: boolean }

  Object.setPrototypeOf(PatchedFontFace, OriginalFontFace)
  PatchedFontFace.prototype = OriginalFontFace.prototype
  PatchedFontFace.__caExcalidrawAssetPatch = true

  Object.defineProperty(window, 'FontFace', {
    configurable: true,
    writable: true,
    value: PatchedFontFace,
  })
}

export {}
