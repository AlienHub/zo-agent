import { spawnSync } from 'node:child_process'

/** Squirrel.Mac needs a stable signing identity across releases. Ad hoc hashes change per build. */
export function macUpdateStrategy(
  runtime: { platform: string; isPackaged: boolean; appPath: string },
  inspect: (args: string[]) => string = (args) => {
    const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', timeout: 5000 })
    if (result.error || result.status !== 0) throw new Error('Unable to verify application signing')
    return result.stdout + result.stderr
  },
): 'native' | 'bundle' | 'disabled' {
  if (runtime.platform !== 'darwin') return 'native'
  if (!runtime.isPackaged) return 'disabled'
  try {
    const details = inspect(['-dv', '--verbose=4', runtime.appPath])
    if (/Signature=adhoc/.test(details)) return 'bundle'
    if ( !/^Authority=Developer ID Application:/m.test(details)
        || !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(details)) return 'disabled'
    inspect(['--verify', '--deep', '--strict', runtime.appPath])
    return 'native'
  } catch {
    return 'disabled'
  }
}
