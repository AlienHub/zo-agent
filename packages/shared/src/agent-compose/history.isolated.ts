import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'zo-history-'));
process.env.CRAFT_CONFIG_DIR = root;
const { saveNode } = await import('./store.ts');
const { listHistory, loadHistory, historyKey } = await import('./history.ts');
const binding = { nodeId: '', projectId: 'p', agentName: 'agent' };
const summary = (id: string, sandboxId = 'sandbox', createdAt = '2026-10-26T10:00:00Z') => ({
  runId: id, projectId: 'p', agentName: 'agent', sandboxId, createdAt,
  completedAt: '2026-10-26T10:01:00Z', status: 'RUN_STATUS_SUCCEEDED',
});
let summaries: any[] = [], details: Record<string, any> = {}, journal: any[] = [], journalMissing = false;
let calls: string[] = [], wrongIdentity = false;
const daemon = Bun.serve({ port: 0, async fetch(request) {
  if (request.headers.get('authorization') !== 'Bearer fixture-token') return new Response('', {status:401});
  const method = new URL(request.url).pathname.split('/').at(-1)!;
  calls.push(method);
  const body = await request.json() as any;
  if (method === 'ListRuns') {
    const matching = summaries.filter(s => !body.sandboxId || s.sandboxId === body.sandboxId);
    return Response.json({ runs: matching.slice(body.offset || 0, (body.offset || 0) + body.limit), total: matching.length });
  }
  if (method === 'GetRun') {
    const detail = details[body.runId];
    return Response.json({run:{ ...detail, summary: wrongIdentity ? {...detail.summary, agentName:'other'} : detail.summary }});
  }
  if (method === 'Exec') return journalMissing ? new Response('', {status:404}) : Response.json({result:{stdout:JSON.stringify({turns:journal})}});
  return new Response('', {status:405});
}});
binding.nodeId = saveNode({name:'Fixture',url:`http://127.0.0.1:${daemon.port}`,token:'fixture-token'}).id;
afterAll(() => { daemon.stop(true); rmSync(root,{recursive:true,force:true}); });
function reset() { summaries=[]; details={}; journal=[]; journalMissing=false; calls=[]; wrongIdentity=false; }
function add(id: string, prompt: string, sandboxId='sandbox', time?:string) {
  const s=summary(id,sandboxId,time); summaries.push(s); details[id]={summary:s,prompt,output:`answer ${id}`}; return s;
}
describe('native remote history', () => {
  test('paginates, groups by sandbox and omits command-only setup runs', async () => {
    reset();
    add('one','first');add('two','second');add('setup','');
    for(let i=0;i<49;i++)add(`other${i}`,`prompt ${i}`,`s${i}`);
    const first=await listHistory(binding);
    expect(first.nextOffset).toBe(50);
    expect(first.items.find(i=>i.target.sandboxId==='sandbox')?.runIds).toEqual(['one','two']);
    const second=await listHistory(binding,first.nextOffset);
    expect(second.items).toHaveLength(2);expect(second.nextOffset).toBeUndefined();
    expect(first.items.every(i=>!i.runIds.includes('setup'))).toBe(true);
  });
  test('imports chronological messages, tools and thinking with namespaced stable ids', async () => {
    reset(); add('later','repeat','sandbox','2026-10-26T10:00:20Z');add('earlier','repeat');
    journal=[{timestamp:Date.parse('2026-10-26T10:00:01Z'),prompt:'repeat',events:[
      {seq:1,kind:'thinking',data:{Text:'plan'}},
      {seq:2,kind:'tool-start',data:{ToolID:'tool1',ToolName:'bash',ToolInput:{command:'pwd'}}},
      {seq:3,kind:'tool-end',data:{ToolID:'tool1',ToolOutput:'/workspace'}},
      {seq:4,kind:'text',data:{Text:'first reply'}},
    ]},{timestamp:Date.parse('2026-10-26T10:00:21Z'),prompt:'repeat',events:[{seq:1,kind:'text',data:{Text:'second reply'}}]}];
    const result=await loadHistory(binding,{sandboxId:'sandbox'});
    expect(result.runIds).toEqual(['earlier','later']);
    expect(result.messages.filter(m=>m.role==='assistant').map(m=>m.content)).toEqual(['first reply','second reply']);
    expect(result.messages.find(m=>m.toolName==='Bash')).toMatchObject({toolResult:'/workspace',toolStatus:'completed'});
    expect(result.messages.find(m=>m.toolName==='Thinking')?.toolResult).toBe('plan');
    const repeated=await loadHistory(binding,{sandboxId:'sandbox'});
    expect(repeated.messages.map(m=>m.id)).toEqual(result.messages.map(m=>m.id));
    expect(new Set(calls)).toEqual(new Set(['ListRuns','GetRun','Exec']));
  });
  test('falls back to persisted result when sandbox or journal is gone, preserving failures and stops', async () => {
    reset();add('ok','one');add('failed','two').status='RUN_STATUS_FAILED';add('stopped','three').status='RUN_STATUS_CANCELED';
    details.ok.resultJson=JSON.stringify({finalText:'persisted final'});
    details.failed.summary.error='model request failed';journalMissing=true;
    const result=await loadHistory(binding,{sandboxId:'sandbox'});
    expect(result.messages.some(m=>m.content==='persisted final')).toBe(true);
    expect(result.messages.some(m=>m.role==='error')).toBe(true);
    expect(result.messages.some(m=>m.role==='info'&&m.content.includes('stopped'))).toBe(true);
    expect(result.warnings).toContain('journal_unavailable');
    expect(calls).not.toContain('StartAgentRun');expect(calls).not.toContain('StopRun');
  });
  test('rejects running histories and does not execute sandbox reads or remote controls', async () => {
    reset();add('active','working').status='RUN_STATUS_RUNNING';
    expect((await listHistory(binding)).items[0]?.active).toBe(true);
    await expect(loadHistory(binding,{sandboxId:'sandbox'})).rejects.toThrow('finish');
    expect(calls).not.toContain('Exec');expect(calls).not.toContain('StopRun');
  });
  test('validates native identity and target rather than importing another agent', async () => {
    reset();add('one','test');wrongIdentity=true;
    await expect(listHistory(binding)).rejects.toThrow('selected agent');
    await expect(loadHistory(binding,{sandboxId:'sandbox'})).rejects.toThrow('selected agent');
    expect(()=>historyKey(binding,{})).toThrow();expect(()=>historyKey(binding,{sandboxId:'s',runId:'r'})).toThrow();
  });
  test('imports runs with missing sandboxes individually and refuses an alternate sandbox alias', async () => {
    reset();add('orphan','old history','');
    expect((await listHistory(binding)).items[0]?.target).toEqual({runId:'orphan'});
    expect((await loadHistory(binding,{runId:'orphan'})).messages[0]?.content).toBe('old history');
    add('normal','sandbox history');
    await expect(loadHistory(binding,{runId:'normal'})).rejects.toThrow('sandbox');
  });
  test('does not silently truncate large run sets at daemon pagination boundaries', async () => {
    reset();for(let i=0;i<503;i++)add(`r${i}`,`message ${i}`);
    const archive=await loadHistory(binding,{sandboxId:'sandbox'});
    expect(archive.runIds).toHaveLength(503);expect(archive.messages.filter(m=>m.role==='user')).toHaveLength(503);
    expect(calls.filter(c=>c==='ListRuns')).toHaveLength(2);
  });
});
