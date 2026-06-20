import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanWorkingDirectory } from '../files'
import type { SessionFile } from '@craft-agent/shared/protocol'

/** Flatten a tree into the set of entry names (depth-first). */
function names(tree: SessionFile[]): Set<string> {
  const out = new Set<string>()
  const visit = (nodes: SessionFile[]) => {
    for (const n of nodes) {
      out.add(n.name)
      if (n.children) visit(n.children)
    }
  }
  visit(tree)
  return out
}

describe('scanWorkingDirectory', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wd-scan-'))
    // Project-ish layout with ignored + kept dotfiles
    await writeFile(join(root, 'README.md'), '# hi')
    await writeFile(join(root, '.gitignore'), 'node_modules')
    await mkdir(join(root, '.github'))
    await writeFile(join(root, '.github', 'ci.yml'), 'on: push')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), 'export {}')
    // Ignored directories with content
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '//')
    await mkdir(join(root, '.git'))
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main')
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist', 'bundle.js'), '//')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('ignores node_modules, .git and dist but keeps other dotfiles', async () => {
    const tree = await scanWorkingDirectory(root, 0, { n: 0 })
    const all = names(tree)

    // Kept
    expect(all.has('README.md')).toBe(true)
    expect(all.has('.gitignore')).toBe(true)
    expect(all.has('.github')).toBe(true)
    expect(all.has('ci.yml')).toBe(true)
    expect(all.has('src')).toBe(true)
    expect(all.has('index.ts')).toBe(true)

    // Ignored (never recursed into)
    expect(all.has('node_modules')).toBe(false)
    expect(all.has('left-pad')).toBe(false)
    expect(all.has('.git')).toBe(false)
    expect(all.has('dist')).toBe(false)
    expect(all.has('bundle.js')).toBe(false)
  })

  it('sorts directories before files, each alphabetically', async () => {
    const tree = await scanWorkingDirectory(root, 0, { n: 0 })
    const topLevel = tree.map(n => `${n.type === 'directory' ? 'd' : 'f'}:${n.name}`)
    // directories first: .github, src ; then files: .gitignore, README.md
    expect(topLevel).toEqual(['d:.github', 'd:src', 'f:.gitignore', 'f:README.md'])
  })

  it('respects the maxDepth bound via the shared counter contract', async () => {
    // Starting at SCAN_MAX_DEPTH should yield nothing (guards runaway recursion)
    const deep = await scanWorkingDirectory(root, 8, { n: 0 })
    expect(deep).toEqual([])
  })
})
