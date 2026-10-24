import { expect, test } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { bindClientUpdates } from '../client-updates'
import type { ElectronAPI } from '../../shared/types'

test('thin-client updates use local IPC while conversation APIs remain remote', async () => {
  const calls: unknown[][] = []
  const remoteChat = async () => 'remote-chat'
  const api = { getSessions: remoteChat, isChannelAvailable: (channel: string) => channel === 'sessions:get' } as unknown as ElectronAPI
  const listeners = new Map<string, (event: unknown, ...args: any[]) => void>()
  bindClientUpdates(api, {
    async invoke(channel, ...args) { calls.push([channel, ...args]); return { currentVersion: '0.2.1' } },
    on(channel, listener) { listeners.set(channel, listener) },
    removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel) },
  })
  expect((await api.getUpdateInfo()).currentVersion).toBe('0.2.1')
  await api.checkForUpdates()
  await api.installUpdate()
  await api.dismissUpdate('0.2.2')
  await api.getDismissedUpdateVersion()
  expect(calls).toEqual([
    [RPC_CHANNELS.update.GET_INFO], [RPC_CHANNELS.update.CHECK],
    [RPC_CHANNELS.update.INSTALL], [RPC_CHANNELS.update.DISMISS, '0.2.2'],
    [RPC_CHANNELS.update.GET_DISMISSED],
  ])
  expect(api.getSessions).toBe(remoteChat)
  expect(api.isChannelAvailable(RPC_CHANNELS.update.CHECK)).toBe(true)
  expect(api.isChannelAvailable('sessions:get')).toBe(true)
  expect(api.isChannelAvailable('not-available')).toBe(false)
  let progress = 0, version = ''
  const removeProgress = api.onUpdateDownloadProgress((value) => { progress = value })
  const removeAvailable = api.onUpdateAvailable((info) => { version = info.latestVersion ?? '' })
  listeners.get(RPC_CHANNELS.update.DOWNLOAD_PROGRESS)!({}, 42)
  listeners.get(RPC_CHANNELS.update.AVAILABLE)!({}, { latestVersion: '0.2.2' })
  expect(progress).toBe(42)
  expect(version).toBe('0.2.2')
  removeProgress(); removeAvailable()
  expect(listeners.size).toBe(0)
})
