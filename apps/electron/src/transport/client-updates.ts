import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ElectronAPI } from '../shared/types'

interface ClientUpdateIpc {
  invoke(channel: string, ...args: unknown[]): Promise<any>
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown
}

/** A thin client's updater belongs to this desktop, never its remote server. */
export function bindClientUpdates(api: ElectronAPI, ipc: ClientUpdateIpc): void {
  const available = api.isChannelAvailable
  const channels = new Set<string>(Object.values(RPC_CHANNELS.update))
  api.isChannelAvailable = (channel) => channels.has(channel) || available(channel)
  api.getUpdateInfo = () => ipc.invoke(RPC_CHANNELS.update.GET_INFO)
  api.checkForUpdates = () => ipc.invoke(RPC_CHANNELS.update.CHECK)
  api.installUpdate = () => ipc.invoke(RPC_CHANNELS.update.INSTALL)
  api.dismissUpdate = (version) => ipc.invoke(RPC_CHANNELS.update.DISMISS, version)
  api.getDismissedUpdateVersion = () => ipc.invoke(RPC_CHANNELS.update.GET_DISMISSED)
  const listen = (channel: string, callback: (...args: any[]) => void) => {
    const listener = (_event: unknown, ...args: any[]) => callback(...args)
    ipc.on(channel, listener)
    return () => { ipc.removeListener(channel, listener) }
  }
  api.onUpdateAvailable = (callback) => listen(RPC_CHANNELS.update.AVAILABLE, callback)
  api.onUpdateDownloadProgress = (callback) => listen(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, callback)
}
