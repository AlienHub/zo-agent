import { describe, it, expect } from 'bun:test'
import {
  buildSceneSkeleton,
  resolveSceneIcon,
  type SceneInput,
} from './sceneSkeleton'
import { roleStyle, theme } from './graphiteStyle'

const BAKE_MODE = 'light' as const

function findById(skeleton: Record<string, unknown>[], id: string): Record<string, unknown> | undefined {
  return skeleton.find((el) => el.id === id)
}

describe('resolveSceneIcon', () => {
  it('returns the whitelisted symbol for known names', () => {
    expect(resolveSceneIcon('check')).toBe('\u2713')
    expect(resolveSceneIcon('warning')).toBe('\u26A0')
    expect(resolveSceneIcon('arrow')).toBe('\u2192')
  })

  it('returns null for unknown names and non-strings', () => {
    expect(resolveSceneIcon('nope')).toBeNull()
    expect(resolveSceneIcon(42)).toBeNull()
    expect(resolveSceneIcon(undefined)).toBeNull()
  })
})

describe('buildSceneSkeleton - nodes', () => {
  it('builds a rectangle container via graphite nodeElement with absolute coords', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'n1', type: 'rectangle', x: 100, y: 200, width: 160, height: 60, label: 'Start' }],
      arrows: [],
    }
    const [el] = buildSceneSkeleton(scene, BAKE_MODE)
    expect(el).toBeDefined()
    expect(el!.type).toBe('rectangle')
    expect(el!.x).toBe(100)
    expect(el!.y).toBe(200)
    expect(el!.width).toBe(160)
    expect(el!.height).toBe(60)
    expect((el!.customData as { graphite: { kind: string; role: string; shape: string } }).graphite).toEqual({
      kind: 'node',
      role: 'default',
      shape: 'rect',
    })
  })

  it('maps ellipse and diamond to their excalidraw types', () => {
    const scene: SceneInput = {
      nodes: [
        { id: 'e', type: 'ellipse', x: 0, y: 0, width: 80, height: 80, label: 'O' },
        { id: 'd', type: 'diamond', x: 100, y: 0, width: 80, height: 80, label: '?' },
      ],
      arrows: [],
    }
    const skeleton = buildSceneSkeleton(scene, BAKE_MODE)
    expect(findById(skeleton, 'e')!.type).toBe('ellipse')
    expect(findById(skeleton, 'd')!.type).toBe('diamond')
  })

  it('renders a text node as a freestanding text element', () => {
    const scene: SceneInput = {
      nodes: [{ id: 't1', type: 'text', x: 10, y: 10, width: 120, height: 24, label: 'Note' }],
      arrows: [],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 't1')!
    expect(el.type).toBe('text')
    expect(el.text).toBe('Note')
  })

  it('skips empty text nodes (no label, no icon)', () => {
    const scene: SceneInput = {
      nodes: [
        { id: 't-empty', type: 'text', x: 0, y: 0, width: 100, height: 20 },
        { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'Keep' },
      ],
      arrows: [],
    }
    const skeleton = buildSceneSkeleton(scene, BAKE_MODE)
    expect(findById(skeleton, 't-empty')).toBeUndefined()
    expect(findById(skeleton, 'r1')).toBeDefined()
  })

  it('applies graphite role colors', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'A', role: 'accent' }],
      arrows: [],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'a')!
    expect(el.strokeColor).toBe(roleStyle('accent', BAKE_MODE).stroke)
    expect(el.backgroundColor).toBe(roleStyle('accent', BAKE_MODE).fill)
  })
})

describe('buildSceneSkeleton - icons', () => {
  it('prepends the whitelisted symbol to the container label', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'n', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'Done', icon: 'check' }],
      arrows: [],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'n')!
    expect((el.label as { text: string }).text).toBe('\u2713 Done')
  })

  it('uses the symbol alone when there is no label', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'n', type: 'ellipse', x: 0, y: 0, width: 60, height: 60, icon: 'star' }],
      arrows: [],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'n')!
    expect((el.label as { text: string }).text).toBe('\u2605')
  })

  it('drops unknown icon names silently', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'n', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'X', icon: 'does-not-exist' }],
      arrows: [],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'n')!
    expect((el.label as { text: string }).text).toBe('X')
  })
})

describe('buildSceneSkeleton - arrows', () => {
  it('converts absolute points to relative Excalidraw points (origin = first point)', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{
        id: 'a1',
        points: [{ x: 100, y: 200 }, { x: 300, y: 400 }, { x: 350, y: 200 }],
      }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'a1')!
    expect(el.type).toBe('arrow')
    expect(el.x).toBe(100)
    expect(el.y).toBe(200)
    expect(el.points).toEqual([[0, 0], [200, 200], [250, 0]])
  })

  it('may be free-floating (no start/end bindings)', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{ id: 'free', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'free')!
    expect(el.start).toBeUndefined()
    expect(el.end).toBeUndefined()
  })

  it('adds start/end bindings when node ids are provided', () => {
    const scene: SceneInput = {
      nodes: [
        { id: 'src', type: 'rectangle', x: 0, y: 0, width: 80, height: 40, label: 'A' },
        { id: 'dst', type: 'rectangle', x: 200, y: 0, width: 80, height: 40, label: 'B' },
      ],
      arrows: [{
        id: 'bound',
        points: [{ x: 80, y: 20 }, { x: 200, y: 20 }],
        start: 'src',
        end: 'dst',
      }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'bound')!
    expect(el.start).toEqual({ id: 'src' })
    expect(el.end).toEqual({ id: 'dst' })
  })

  it('honors dashed and no-arrowhead options', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{
        id: 'dashed',
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
        dashed: true,
        arrow: false,
      }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'dashed')!
    expect(el.strokeStyle).toBe('dashed')
    expect(el.endArrowhead).toBeNull()
  })

  it('attaches an edge label', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{ id: 'labeled', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], label: 'yes' }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'labeled')!
    expect((el.label as { text: string }).text).toBe('yes')
  })

  it('uses role colors for orange callout arrows', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{ id: 'orange', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], role: 'alert' }],
    }
    const el = findById(buildSceneSkeleton(scene, BAKE_MODE), 'orange')!
    expect(el.strokeColor).toBe(roleStyle('alert', BAKE_MODE).stroke)
    expect((el.customData as { graphite: { role: string } }).graphite.role).toBe('alert')
  })

  it('throws when an arrow has fewer than 2 points', () => {
    const scene: SceneInput = {
      nodes: [],
      arrows: [{ id: 'bad', points: [{ x: 0, y: 0 }] }],
    }
    expect(() => buildSceneSkeleton(scene, BAKE_MODE)).toThrow(/at least 2 points/)
  })
})

describe('buildSceneSkeleton - title', () => {
  it('places the title above the top-leftmost node', () => {
    const scene: SceneInput = {
      nodes: [
        { id: 'a', type: 'rectangle', x: 120, y: 80, width: 100, height: 50, label: 'A' },
        { id: 'b', type: 'rectangle', x: 300, y: 200, width: 100, height: 50, label: 'B' },
      ],
      arrows: [],
      title: 'My Diagram',
    }
    const title = findById(buildSceneSkeleton(scene, BAKE_MODE), 'canvas-title')!
    expect(title.type).toBe('text')
    expect(title.x).toBe(120)
    expect(title.y).toBe(80 - 44)
    expect(title.text).toBe('My Diagram')
  })

  it('uses a fallback position when there are no nodes', () => {
    const scene: SceneInput = { nodes: [], arrows: [], title: 'Empty' }
    const title = findById(buildSceneSkeleton(scene, BAKE_MODE), 'canvas-title')!
    expect(title.x).toBe(48)
    expect(title.y).toBe(48)
  })

  it('omits the title when blank', () => {
    const scene: SceneInput = { nodes: [], arrows: [], title: '   ' }
    expect(findById(buildSceneSkeleton(scene, BAKE_MODE), 'canvas-title')).toBeUndefined()
  })
})

describe('buildSceneSkeleton - dark mode baking', () => {
  it('stamps graphite tags so the display can recolor later', () => {
    const scene: SceneInput = {
      nodes: [{ id: 'n', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'X', role: 'alert' }],
      arrows: [{ id: 'e', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
    }
    const skeleton = buildSceneSkeleton(scene, 'dark')
    const node = findById(skeleton, 'n')!
    const edge = findById(skeleton, 'e')!
    expect((node.customData as { graphite: { kind: string } }).graphite.kind).toBe('node')
    expect(node.strokeColor).toBe(roleStyle('alert', 'dark').stroke)
    expect((edge.customData as { graphite: { kind: string } }).graphite.kind).toBe('edge')
    expect(edge.strokeColor).toBe(theme('dark').edge)
  })
})
