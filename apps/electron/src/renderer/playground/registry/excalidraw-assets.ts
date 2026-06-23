declare const __EXCALIDRAW_DEV_ASSET_PATH__: string

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = __EXCALIDRAW_DEV_ASSET_PATH__

export {}
