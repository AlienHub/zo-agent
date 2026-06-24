import { contextBridge, ipcRenderer } from 'electron'

const CHANNELS = {
  request: 'excalidraw-materializer:request',
  response: 'excalidraw-materializer:response',
  ready: 'excalidraw-materializer:ready',
} as const

contextBridge.exposeInMainWorld('__excalidrawMaterializerBridge', {
  ready: () => ipcRenderer.send(CHANNELS.ready),
  respond: (payload: unknown) => ipcRenderer.send(CHANNELS.response, payload),
})

ipcRenderer.on(CHANNELS.request, (_event, payload) => {
  window.dispatchEvent(new CustomEvent('craft:excalidraw-materialize', { detail: payload }))
})
