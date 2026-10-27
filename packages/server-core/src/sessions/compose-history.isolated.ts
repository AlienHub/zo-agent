import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=mkdtempSync(join(tmpdir(),'zo-history-sessions-'));
process.env.CRAFT_CONFIG_DIR=root;
const {saveConfig,addWorkspace}=await import('@craft-agent/shared/config/storage');
const {saveNode,writeState}=await import('@craft-agent/shared/agent-compose/store');
const {syncAgentConnections,connectionSlug}=await import('@craft-agent/shared/agent-compose/catalog');
const {getSessionPath,loadSession}=await import('@craft-agent/shared/sessions/storage');
const {SessionManager}=await import('./SessionManager.ts');
let runs=[{summary:{runId:'r1',projectId:'project',agentName:'agent',sandboxId:'sandbox',status:'RUN_STATUS_SUCCEEDED',createdAt:'2026-10-25T10:00:00Z',completedAt:'2026-10-25T10:01:00Z'},prompt:'Historical prompt',output:'Historical reply'}];
let mutationCalls=0;
const daemon=Bun.serve({port:0,async fetch(request){
 const method=new URL(request.url).pathname.split('/').at(-1),body=await request.json() as any;
 if(method==='ListRuns')return Response.json({runs:runs.map(r=>r.summary),total:runs.length});
 if(method==='GetRun')return Response.json({run:runs.find(r=>r.summary.runId===body.runId)});
 if(method==='Exec')return new Response('',{status:404});
 if(method==='GetProject')return Response.json({project:{summary:{projectId:'project'},spec:{},agents:[{agentName:'disabled-agent',displayName:'Disabled Agent',provider:'dsh',model:'remote',enabled:false}]}});
 mutationCalls++;return new Response('',{status:405});
}});
saveConfig({workspaces:[],activeWorkspaceId:null,activeSessionId:null,llmConnections:[]} as any);
const workspace=addWorkspace({name:'History',rootPath:join(root,'workspace')});
const node=saveNode({name:'History fixture',url:`http://127.0.0.1:${daemon.port}`,token:'fixture'});
const binding={nodeId:node.id,projectId:'project',agentName:'agent'};
syncAgentConnections([{...binding,name:'Native Agent',model:'remote',provider:'pi',enabled:true,specHash:'v1',spec:{}}]);
const managers:any[]=[];
function manager(){const sm=new SessionManager();sm.setEventSink(()=>{});managers.push(sm);return sm;}
afterAll(async()=>{for(const sm of managers)sm.cleanup();daemon.stop(true);rmSync(root,{recursive:true,force:true});});
test('concurrent imports deduplicate, persist and reload as read-only; refreshing merges without duplicating',async()=>{
 const sm=manager();
 const [first,duplicate]=await Promise.all([sm.importComposeHistory(workspace.id,binding,{sandboxId:'sandbox'}),sm.importComposeHistory(workspace.id,binding,{sandboxId:'sandbox'})]);
 expect(first.sessionId).toBe(duplicate.sessionId);expect(sm.getSessions(workspace.id)).toHaveLength(1);
 const session=await sm.getSession(first.sessionId);
 expect(session?.messages.filter(m=>m.role==='user')).toHaveLength(1);
 expect(session?.composeHistory?.runIds).toEqual(['r1']);expect(session?.supportsBranching).toBe(false);
 const stored=loadSession(workspace.rootPath,first.sessionId);
 expect(stored?.composeHistory?.runIds).toEqual(['r1']);
 await expect(sm.sendMessage(first.sessionId,'must not execute')).rejects.toThrow('read-only');
 const restored=manager();(restored as any).loadSessionsFromDisk();
 const recovered=await restored.getSession(first.sessionId);
 expect(recovered?.composeHistory?.runIds).toEqual(['r1']);expect(recovered?.messages.map(m=>m.content)).toEqual(['Historical prompt','Historical reply']);
 await expect(restored.sendMessage(first.sessionId,'must not execute')).rejects.toThrow('read-only');
 runs.push({summary:{...runs[0]!.summary,runId:'r2',createdAt:'2026-10-25T10:02:00Z',completedAt:'2026-10-25T10:03:00Z'},prompt:'Another prompt',output:'Another reply'});
 const refreshed=await sm.importComposeHistory(workspace.id,binding,{sandboxId:'sandbox'});
 expect(refreshed.sessionId).toBe(first.sessionId);expect(refreshed.existing).toBe(true);
 expect((await sm.getSession(first.sessionId))?.messages.filter(m=>m.role==='user')).toHaveLength(2);
 // A daemon can purge an older run and its output; an already imported
 // transcript must remain available rather than degrading on refresh.
 const savedRuns=runs;
 runs=[{...runs[1]!,output:''}];
 try {
  await sm.importComposeHistory(workspace.id,binding,{sandboxId:'sandbox'});
  const retained=await sm.getSession(first.sessionId);
  expect(retained?.messages.map(m=>m.content)).toEqual(['Historical prompt','Historical reply','Another prompt','Another reply']);
  expect(retained?.composeHistory?.runIds).toEqual(['r1','r2']);
 }finally{runs=savedRuns}
 expect(mutationCalls).toBe(0);
});
test('history from a normal Zo conversation opens the original instead of creating an archive',async()=>{
 const sm=manager();
 const local=await sm.createSession(workspace.id,{name:'Original',llmConnection:connectionSlug(binding)});
 writeState(getSessionPath(workspace.rootPath,local.id),{version:1,binding,sandboxId:'already-known',turns:[]});
 const imported=await sm.importComposeHistory(workspace.id,binding,{sandboxId:'already-known'});
 expect(imported.sessionId).toBe(local.id);expect(imported.existing).toBe(true);
 expect(sm.getSessions(workspace.id)).toHaveLength(1);expect((await sm.getSession(local.id))?.composeHistory).toBeUndefined();
});
test('disabled native agents can import history without becoming runnable connections',async()=>{
 const sm=manager();
 const disabledBinding={...binding,agentName:'disabled-agent'};
 const prior=runs;
 runs=[{...runs[0]!,summary:{...runs[0]!.summary,agentName:'disabled-agent'}}];
 try {
  const imported=await sm.importComposeHistory(workspace.id,disabledBinding,{sandboxId:'sandbox'});
  expect((await sm.getSession(imported.sessionId))?.composeHistory).toBeDefined();
  const {getLlmConnection}=await import('@craft-agent/shared/config/storage');
  expect(getLlmConnection(connectionSlug(disabledBinding))?.composeUnavailable).toBe(true);
  expect(mutationCalls).toBe(0);
 }finally{runs=prior}
});
