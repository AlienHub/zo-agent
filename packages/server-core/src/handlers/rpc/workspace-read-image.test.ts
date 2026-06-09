import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { resolveWorkspaceImageReadPath } from './workspace'

describe('workspace read image path resolution', () => {
  it('prefers .zo for workspace-owned entity icons', () => {
    const root = '/tmp/project'
    const existing = new Set([
      join(root, '.zo', 'statuses', 'icons', 'todo.svg'),
    ])

    const resolved = resolveWorkspaceImageReadPath(
      root,
      'statuses/icons/todo.svg',
      path => existing.has(path),
    )

    expect(resolved).toBe(join(root, '.zo', 'statuses', 'icons', 'todo.svg'))
  })

  it('falls back to legacy root layout for existing older icons', () => {
    const root = '/tmp/project'

    const resolved = resolveWorkspaceImageReadPath(
      root,
      'sources/github/icon.svg',
      () => false,
    )

    expect(resolved).toBe(join(root, 'sources', 'github', 'icon.svg'))
  })

  it('keeps workspace root icons at the root', () => {
    const root = '/tmp/project'
    const existing = new Set([
      join(root, '.zo', 'icon.svg'),
    ])

    const resolved = resolveWorkspaceImageReadPath(
      root,
      './icon.svg',
      path => existing.has(path),
    )

    expect(resolved).toBe(join(root, 'icon.svg'))
  })
})
