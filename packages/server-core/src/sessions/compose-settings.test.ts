import { describe, expect, test } from 'bun:test'
import { SessionManager } from './SessionManager'
import { getExecutionCapabilities } from '@craft-agent/shared/agent-compose/capabilities'

function fixture() {
  const managed = {
    id: 'remote-settings', llmConnection: 'unavailable-compose-agent', connectionLocked: true,
    workspace: { id: 'workspace', rootPath: '/nonexistent-zo-scope-test' },
    workingDirectory: '/__agent_compose__/remote-settings/workspace',
    permissionMode: 'ask', thinkingLevel: 'medium', codingMode: false, model: 'remote-model',
    enabledSourceSlugs: ['previously-saved-source'], messages: [],
  }
  const manager = Object.create(SessionManager.prototype) as SessionManager
  let writes = 0
  Object.assign(manager, { sessions: new Map([[managed.id, managed]]), persistSession: () => { writes++ }, sendEvent: () => { writes++ } })
  return { manager, managed, writes: () => writes }
}

describe('Compose execution settings boundary', () => {
  test('remote and missing connections retain sandbox policy; local Pi retains local controls', () => {
    expect(getExecutionCapabilities({ compose: { nodeId: 'node' } }).localTools).toBe(false)
    expect(getExecutionCapabilities(null, '/__agent_compose__/old/workspace').permissions).toBe(false)
    expect(getExecutionCapabilities(null, '/local/project').localTools).toBe(true)
    expect(getExecutionCapabilities({ compose: undefined }).modelOverride).toBe(true)
  })
  test('remote setting commands reject before changing metadata, local folders, sources or emitting success', async () => {
    const { manager, managed, writes } = fixture()
    const before = JSON.stringify(managed)
    expect(() => manager.updateWorkingDirectory(managed.id, '/tmp/local-folder')).toThrow(/Agent Compose/)
    expect(() => manager.setSessionPermissionMode(managed.id, 'allow-all')).toThrow(/Agent Compose/)
    expect(() => manager.setSessionThinkingLevel(managed.id, 'max' as never)).toThrow(/Agent Compose/)
    expect(() => manager.setSessionCodingMode(managed.id, true)).toThrow(/Agent Compose/)
    await expect(manager.setSessionSources(managed.id, ['local-api'])).rejects.toThrow(/Agent Compose/)
    await expect(manager.updateSessionModel(managed.id, managed.workspace.id, 'local-model')).rejects.toThrow(/Agent Compose/)
    expect(JSON.stringify(managed)).toBe(before)
    expect(writes()).toBe(0)
  })
  test('unsupported skills and local compaction fail before message persistence or submission', async () => {
    const { manager, managed, writes } = fixture()
    let acked = false
    await expect(manager.sendMessage(managed.id, '/compact', undefined, undefined, undefined, undefined, undefined, () => { acked = true })).rejects.toThrow(/Agent Compose/)
    await expect(manager.sendMessage(managed.id, 'Read my skill', undefined, undefined, { skillSlugs: ['local-skill'] })).rejects.toThrow(/Agent Compose/)
    expect(managed.messages).toEqual([])
    expect(acked).toBe(false)
    expect(writes()).toBe(0)
  })
})
