import {afterAll,expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'zo-cli-management-'));
process.env.CRAFT_CONFIG_DIR=join(root,'config');
const {runManagementCli,managementRpcAllowed,redactManagementOutput,selectManagementNode,managementBinary}=await import('./management-cli.ts');
const {saveNode}=await import('./store.ts');
let writes=0,reads=0,badAuth=0;
const daemon=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 if(request.headers.get('authorization')!=='Bearer fixture-daemon-secret'){badAuth++;return new Response('',{status:401});}
 if(new URL(request.url).pathname.endsWith('ListProjects')){
  reads++;
  if(request.headers.get('content-type')?.startsWith('application/proto')) {
   const field=(tag:number,value:Buffer)=>Buffer.concat([Buffer.from([tag,value.length]),value]);
   const project=Buffer.concat([field(10,Buffer.from('project')),field(18,Buffer.from('Fixture Project'))]);
   return new Response(Buffer.concat([field(10,project),Buffer.from([16,1])]),{headers:{'content-type':'application/proto'}});
  }
  return Response.json({projects:[{projectId:'project',name:'Fixture Project'}],total:1});
 }
 writes++;return Response.json({stopped:true});
}});
const node=saveNode({name:'Fixture',url:`http://127.0.0.1:${daemon.port}`,token:'fixture-daemon-secret'});
const fake=join(root,'fake-cli');
writeFileSync(fake,`#!/usr/bin/env bun
import {readFileSync,statSync} from 'node:fs';
const args=process.argv.slice(2),host=args[args.indexOf('--host')+1];
const cfg=JSON.parse(readFileSync(process.env.AGENT_COMPOSE_CONFIG,'utf8'));
if(statSync(process.env.AGENT_COMPOSE_CONFIG).mode&0o077)throw new Error('unprotected config');
if(process.env.CRAFT_SERVER_TOKEN||JSON.stringify(cfg).includes('fixture-daemon-secret'))throw new Error('daemon credential entered child');
if(args.includes('wait'))await new Promise(()=>{});
if(args.includes('oversized')){console.log('x'.repeat(9<<20));process.exit(0);}
const method=args.includes('stop')||args.includes('attack')?'StopSandbox':'ListProjects';
const service=method==='StopSandbox'?'SandboxService':'ProjectService';
const response=await fetch(host+'/agentcompose.v2.'+service+'/'+method,{method:'POST',body:'{}',headers:{'content-type':'application/json',authorization:'Bearer '+cfg.hosts[host].token}});
console.log(JSON.stringify({status:response.status,response:await response.json()}));
process.exitCode=response.ok?0:1;
`);chmodSync(fake,0o755);
afterAll(()=>{daemon.stop(true);rmSync(root,{recursive:true,force:true});});
test('native upstream CLI can list projects using bound authentication',async()=>{
 const result=await runManagementCli(node,'read',['project','ls','--limit','1']);
 expect(result).toMatchObject({code:0});expect(result.stdout).toContain('Fixture Project');expect(badAuth).toBe(0);
});
test('management entry does not inherit Pi model proxies for a saved direct connection',async()=>{
 const child=Bun.spawn([join(process.cwd(),'apps/electron/resources/bin/zo-compose'),'read',node.id,'--','project','ls','--limit','1'],{
  env:{...process.env,CRAFT_BUN:process.execPath,CRAFT_COMPOSE_CLI_ENTRY:join(import.meta.dir,'management-cli.ts'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'',no_proxy:''},stdout:'pipe',stderr:'pipe',
 });
 const output=await new Response(child.stdout).text();
 const error=await new Response(child.stderr).text();
 expect(error).toBe('');expect(await child.exited).toBe(0);expect(output).toContain('Fixture Project');
});
test('read enforcement happens at RPC boundary, even if a CLI attempts a write',async()=>{
 process.env.CRAFT_SERVER_TOKEN='must-not-enter-child';
 const before=writes;
 const denied=await runManagementCli(node,'read',['project','ls','attack'],fake);
 expect(denied.code).not.toBe(0);expect(denied.stdout).toContain('403');expect(writes).toBe(before);
 const allowed=await runManagementCli(node,'write',['sandbox','stop','sandbox-id'],fake);
 expect(allowed.code).toBe(0);expect(writes).toBe(before+1);expect(badAuth).toBe(0);
 delete process.env.CRAFT_SERVER_TOKEN;
});
test('rejects endpoint overrides and host daemon/auth execution before spawning',async()=>{
 await expect(runManagementCli(node,'read',['--json','daemon'],fake)).rejects.toThrow();
 await expect(runManagementCli(node,'write',['auth','ls'],fake)).rejects.toThrow();
 await expect(runManagementCli(node,'write',['ps','--host=http://other'],fake)).rejects.toThrow();
 await expect(runManagementCli(node,'read',['project','ls','-f','private.yml'],fake)).rejects.toThrow();
 await expect(runManagementCli(node,'read',['llm','generate','--prompt-file','private.txt'],fake)).rejects.toThrow();
 expect(managementRpcAllowed('/agentcompose.v2.ExecService/Exec','read')).toBe(false);
 expect(managementRpcAllowed('/agentcompose.v2.LLMService/Generate','read')).toBe(false);
 expect(managementRpcAllowed('/agentcompose.v2.ProjectService/ValidateProject','read')).toBe(false);
});
test('redacts known tokens, provider credentials, headers and environment values',()=>{
 const text=redactManagementOutput(JSON.stringify({token:'key',spec:{env:[{name:'CUSTOM',value:'secret-value'}],headers:{Authorization:'bearer key'},apiKey:'provider-key'},output:'fixture-daemon-secret'}),node.token);
 for(const value of ['secret-value','provider-key','fixture-daemon-secret'])expect(text).not.toContain(value);
 expect(text).toContain('[redacted]');
});
test('oversized output fails without returning a partial, unparseable transcript',async()=>{
 const result=await runManagementCli(node,'read',['logs','oversized'],fake);
 expect(result.code).not.toBe(0);expect(result.stdout).toBe('');expect(result.stderr).toContain('exceeded');
});
test('selects registered node identities and bundles a native executable rather than the host shim',()=>{
 expect(selectManagementNode(node.name).id).toBe(node.id);
 expect(()=>selectManagementNode('http://unregistered')).toThrow();
 expect(readFileSync(managementBinary()).subarray(0,2).toString()).not.toBe('#!');
});

test('cancelling an observer releases its process, relay and temporary CLI profile',async()=>{
 const before=new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('zo-compose-cli-')));
 const controller=new AbortController();
 const pending=runManagementCli(node,'read',['logs','wait'],fake,controller.signal);
 setTimeout(()=>controller.abort(),80);
 const result=await pending;
 expect(result.code).not.toBe(0);
 expect(readdirSync(tmpdir()).filter(name=>name.startsWith('zo-compose-cli-')&&!before.has(name))).toHaveLength(0);
});
