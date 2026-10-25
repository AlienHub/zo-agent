import { expect, test } from 'bun:test'
import { mockMacUpdater } from './auto-update-fixture'
const fixture = mockMacUpdater('bundle')
const updates = await import('../auto-update')

test('ad hoc updates validate and hand off before quitting; preparation failure keeps services alive', async () => {
  updates.setBeforeUpdateQuitHook(() => { fixture.effects.hooks++ })
  updates.setBeforeUpdateInstallHook(async () => { fixture.effects.hooks++ })
  expect(fixture.updater.autoDownload).toBe(true)
  expect(fixture.updater.autoInstallOnAppQuit).toBe(false)
  await updates.checkForUpdates()
  await expect(updates.installUpdate()).rejects.toThrow('No update ready')
  fixture.updater.emit('update-downloaded', { version: '0.2.2' })
  expect(updates.getUpdateInfo().downloadState).toBe('ready')
  fixture.effects.failPrepare = true
  await expect(updates.installUpdate()).rejects.toThrow('checksum')
  expect(fixture.effects.hooks).toBe(0)
  expect(fixture.effects.quit).toBe(0)
  expect(updates.isUpdating()).toBe(false)
  fixture.effects.failPrepare = false
  await updates.checkForUpdates()
  fixture.updater.emit('update-downloaded', { version: '0.2.2' })
  await updates.installUpdate()
  expect(fixture.effects.hooks).toBe(2)
  expect(fixture.effects.committed).toBe(1)
  expect(fixture.effects.quit).toBe(1)
})
