import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const { inspectArchive } = require('../../../resources/scripts/mac-update-helper.cjs')

// Minimal central-directory fixtures isolate the path check from macOS extraction.
async function archive(entries: { name: string; symlink?: boolean }[], check: (file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zo-zip-check-'))
  const records = entries.map(({ name, symlink }) => {
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(Buffer.byteLength(name), 28)
    record.writeUInt32LE(((symlink ? 0xa1ff : 0x81a4) << 16) >>> 0, 38)
    return Buffer.concat([record, Buffer.from(name)])
  })
  const central = Buffer.concat(records)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  const file = path.join(directory, 'update.zip')
  await writeFile(file, Buffer.concat([central, end]))
  try { await check(file) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('normal framework symlinks do not block archive inspection', async () => {
  await archive([
    { name: 'Zo.app/Contents/Frameworks/F.framework/Versions/A/F' },
    { name: 'Zo.app/Contents/Frameworks/F.framework/Versions/Current', symlink: true },
  ], async file => expect(await inspectArchive(file)).toBeUndefined())
})
test.each(['../outside', '/tmp/outside', 'Zo.app/../outside', 'Zo.app/./file', 'Zo.app\\..\\outside', 'Zo.app/\x00outside'])('reject unsafe ZIP path %j before extraction', async name => {
  await archive([{ name }], async file => { await expect(inspectArchive(file)).rejects.toThrow('Unsafe') })
})
test('reject writes through a symlink regardless of entry order', async () => {
  await archive([{ name: 'Zo.app/link/outside' }, { name: 'Zo.app/link', symlink: true }], async file => {
    await expect(inspectArchive(file)).rejects.toThrow('symlink')
  })
})
