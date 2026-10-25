import { expect, test } from 'bun:test'
import { macUpdateStrategy } from '../mac-update-policy'

const runtime = { platform: 'darwin', isPackaged: true, appPath: '/Applications/Zo.app' }
test('only a verified Developer ID build uses the macOS automatic installer', () => {
  const calls: string[][] = []
  expect(macUpdateStrategy(runtime, (args) => {
    calls.push(args)
    return 'Authority=Developer ID Application: Zo\nTeamIdentifier=ABC1234567\n'
  })).toBe('native')
  expect(calls[1]).toEqual(['--verify', '--deep', '--strict', runtime.appPath])
  expect(macUpdateStrategy(runtime, () => 'Signature=adhoc\nTeamIdentifier=not set')).toBe('bundle')
  for (const details of [ 'Authority=Apple Development: Zo\nTeamIdentifier=ABC1234567', '']) {
    expect(macUpdateStrategy(runtime, () => details)).toBe('disabled')
  }
  expect(macUpdateStrategy(runtime, () => { throw new Error('codesign failed') })).toBe('disabled')
  let invoked = false
  expect(macUpdateStrategy(runtime, (args) => {
    if (args.includes('--verify')) { invoked = true; throw new Error('nested signature invalid') }
    return 'Authority=Developer ID Application: Zo\nTeamIdentifier=ABC1234567'
  })).toBe('disabled')
  expect(invoked).toBe(true)
})
test('development macOS builds cannot install; other platforms keep their native installers', () => {
  const unexpected = () => { throw new Error('should not inspect this runtime') }
  expect(macUpdateStrategy({ ...runtime, isPackaged: false }, unexpected)).toBe('disabled')
  expect(macUpdateStrategy({ ...runtime, platform: 'win32' }, unexpected)).toBe('native')
  expect(macUpdateStrategy({ ...runtime, platform: 'linux' }, unexpected)).toBe('native')
})
