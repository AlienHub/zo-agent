import { expect, mock, test } from 'bun:test'
mock.module('electron', () => ({ app: {}, BrowserWindow: {} }))
const { macArtifactFromDownload } = await import('../mac-bundle-update')
test('use the exact ZIP checksum in multi-architecture releases and reject unrelated cached files', () => {
  const hash = Buffer.alloc(64, 17).toString('base64')
  const info = {
    version: '0.2.2', downloadedFile: '/cache/Zo-0.2.2-arm64.zip',
    files: [
      { url: 'Zo-0.2.2-arm64.dmg', sha512: 'wrong' },
      { url: 'Zo-0.2.2-x64.zip', sha512: 'wrong' },
      { url: 'https://example.com/Zo-0.2.2-arm64.zip', sha512: hash },
    ],
  }
  expect(macArtifactFromDownload(info)).toEqual({ archive: info.downloadedFile, version: info.version, sha512: hash })
  expect(() => macArtifactFromDownload({ ...info, downloadedFile: '/cache/other.zip' })).toThrow('matching checksum')
  expect(() => macArtifactFromDownload({ ...info, downloadedFile: '/cache/Zo-0.2.2-arm64.dmg' })).toThrow('verified ZIP')
})
