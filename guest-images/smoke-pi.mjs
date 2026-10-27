import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the real upstream Pi runner against loopback fixtures. No external
// model, user credentials, or user workspace is involved.
const { PiRunner } = await import('/usr/lib/node_modules/@chaitin-ai/agent-compose-runtime/dist/runners/pi.js')
const directory = mkdtempSync(join(tmpdir(), 'zo-pi-smoke-'))
const previousConfig = process.env.PI_CODING_AGENT_DIR
const previousModel = process.env.AGENT_COMPOSE_RESOLVED_MODEL
let modelCalls = 0, mcpCalls = 0, heldResponse
let phase = 'starting', diagnostic = ''
const fixtureErrors = []
const capture = text => { diagnostic = (diagnostic + text).slice(-12000) }
let notifyHeld
const held = new Promise(resolve => { notifyHeld = resolve })
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let input = ''
    for await (const chunk of req) input += chunk
    const body = JSON.parse(input)
    if (req.url === '/mcp') {
      assert.equal(req.headers.authorization, 'Bearer zo-smoke-fixture')
      if (body.id === undefined) { res.writeHead(202).end(); return }
      let result
      switch (body.method) {
        case 'initialize':
          result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'zo-image-check', version: '1' } }
          break
        case 'tools/list':
          result = { tools: [{ name: 'zo_marker', description: 'Return the runtime check marker', inputSchema: { type: 'object', properties: {} } }] }
          break
        case 'resources/list': result = { resources: [] }; break
        case 'resources/templates/list': result = { resourceTemplates: [] }; break
        case 'prompts/list': result = { prompts: [] }; break
        case 'tools/call':
          assert.equal(body.params.name, 'zo_marker')
          mcpCalls++
          result = { content: [{ type: 'text', text: 'ZO_RUNTIME_MCP_OK' }] }
          break
        case 'ping': result = {}; break
        default: throw new Error('Unexpected MCP method ' + body.method)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
      return
    }
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(body.model, 'zo-runtime-smoke')
    assert.ok(++modelCalls <= 6, 'Unexpected extra model request')
    if (modelCalls === 5) {
      heldResponse = res
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': waiting for cancellation\n\n')
      notifyHeld()
      return
    }
    let delta, reason
    if (modelCalls <= 2) {
      const args = modelCalls === 1 ? { connect: 'fixture' } : { server: 'fixture', tool: 'fixture_zo_marker', args: '{}' }
      delta = { role: 'assistant', tool_calls: [{ index: 0, id: `call_${modelCalls}`, type: 'function', function: { name: 'mcp', arguments: JSON.stringify(args) } }] }
      reason = 'tool_calls'
    } else {
      const history = JSON.stringify(body.messages)
      assert.ok(history.includes('ZO_RUNTIME_MCP_OK'), 'MCP result was not retained: ' + JSON.stringify(body.messages.filter(message => message.role === 'tool').map(message => message.content)))
      if (modelCalls >= 4) assert.ok(history.includes('ZO_RUNTIME_REPLY_OK'), 'Session history was not restored')
      delta = { role: 'assistant', content: modelCalls === 3 ? 'ZO_RUNTIME_REPLY_OK' : modelCalls === 4 ? 'ZO_RUNTIME_RESUMED_OK' : 'ZO_RUNTIME_AFTER_STOP_OK' }
      reason = 'stop'
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [eventDelta, finishReason] of [[delta, null], [{}, reason]]) {
      res.write('data: ' + JSON.stringify({ id: `smoke_${modelCalls}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: eventDelta, finish_reason: finishReason }] }) + '\n\n')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) {
    fixtureErrors.push(String(error))
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Runtime fixture rejected an unexpected request', type: 'invalid_request_error' } }))
  }
})
const deadline = setTimeout(() => { console.error(JSON.stringify({ error: 'Pi runtime smoke timed out', phase, modelCalls, mcpCalls, diagnostic, fixtureErrors })); process.exit(1) }, 45_000)
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  const config = join(directory, 'pi')
  const workspace = join(directory, 'workspace')
  mkdirSync(config)
  mkdirSync(workspace)
  writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { 'agent-compose': { baseUrl: address + '/v1', api: 'openai-completions', apiKey: 'zo-smoke-fixture', models: [{ id: 'zo-runtime-smoke', reasoning: false, contextWindow: 32000, maxTokens: 1000 }] } } }))
  process.env.PI_CODING_AGENT_DIR = config
  delete process.env.AGENT_COMPOSE_RESOLVED_MODEL
  const runner = abortController => new PiRunner({
    sessionRoot: join(directory, 'state'), home: directory, workspace,
    model: 'zo-runtime-smoke', abortController,
    mcpConfig: { fixture: { type: 'remote', url: address + '/mcp', headers: { Authorization: { value: 'Bearer zo-smoke-fixture' } } } },
  }, { write: capture, line: capture, transcript() { return diagnostic } })
  phase = 'first MCP turn'
  const first = await runner(new AbortController()).runPrompt('Call the MCP fixture and return its marker.')
  assert.equal(first.finalText, 'ZO_RUNTIME_REPLY_OK')
  assert.equal(mcpCalls, 1)
  phase = 'history resume'
  const second = await runner(new AbortController()).runPrompt('Continue the existing session.')
  assert.equal(second.threadId, first.threadId)
  assert.equal(second.finalText, 'ZO_RUNTIME_RESUMED_OK')
  const controller = new AbortController()
  phase = 'waiting for model stream'
  const stopping = runner(controller).runPrompt('Wait until stopped.')
  await Promise.race([held, stopping.then(() => { throw new Error('Run ended before cancellation fixture') })])
  controller.abort()
  phase = 'cancellation'
  const stopped = await stopping
  assert.equal(stopped.stopReason, 'cancelled')
  heldResponse?.end()
  phase = 'resume after stop'
  const after = await runner(new AbortController()).runPrompt('Continue after stopping.')
  assert.equal(after.threadId, first.threadId)
  assert.equal(after.finalText, 'ZO_RUNTIME_AFTER_STOP_OK')
  assert.equal(modelCalls, 6)
  assert.deepEqual(fixtureErrors, [])
  console.log(JSON.stringify({ piRunner: 'passed', authenticatedHttpMcp: 'passed', sessionHistory: 'passed', cancellation: 'passed', resumeAfterStop: 'passed' }))
} finally {
  clearTimeout(deadline)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  if (previousConfig === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousConfig
  if (previousModel === undefined) delete process.env.AGENT_COMPOSE_RESOLVED_MODEL
  else process.env.AGENT_COMPOSE_RESOLVED_MODEL = previousModel
  rmSync(directory, { recursive: true, force: true })
}
