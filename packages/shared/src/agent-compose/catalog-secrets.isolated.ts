import {afterAll, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'zo-agent-secret-clone-'));
process.env.CRAFT_CONFIG_DIR=root;
const {saveNode}=await import('./store.ts');
const {createAgent,editAgent}=await import('./catalog.ts');
const template:any={name:'pi',provider:'pi',model:'model',image:'runtime:pi',driver:{name:'docker',docker:{}},
 sandbox:{network:{default:'deny'}},systemPrompt:'Original instructions',
 env:[{name:'TOKEN',value:'********',secret:true}],
 workspace:{provider:'git',url:'https://example.test/repo',token:'********'},
 skills:[{name:'private',token:'********'}],scheduler:{enabled:true},
 mcpServers:[{name:'devboard',type:'remote',transport:'http',url:'https://example.test/mcp',headers:[{name:'Authorization',value:'********',secret:true}]}]};
let lastPatch:any,patches=0;
const project=()=>({summary:{projectId:'project',name:'native',specHash:'v1'},spec:{name:'native',agents:[structuredClone(template),{name:'sibling',model:'other'}]},
 agents:[{agentName:'pi',provider:'pi',model:'model',enabled:true}]});
const marker=(value:any):boolean=>value==='********'||!!value&&typeof value==='object'&&Object.values(value).some(marker);
const daemon=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const method=new URL(req.url).pathname.split('/').at(-1);
 const body=await req.json() as any;
 expect(req.headers.get('authorization')).toBe('Bearer fixture');
 if(method==='ListProjects')return Response.json({projects:[{projectId:'project',name:'native'}],total:1});
 if(method==='GetProject')return Response.json({project:project()});
 if(method==='PatchProject'){
  lastPatch=body;patches++;
  for(const agent of body.spec.agents)if(!['pi','sibling'].includes(agent.name)&&marker(agent))
   return Response.json({issues:[{severity:'VALIDATION_SEVERITY_ERROR',path:`agents.${agent.name}.mcp_servers.devboard.headers.Authorization.value`,message:'redacted value marker has no existing value to preserve'}]});
  return Response.json({applied:!body.dryRun});
 }
 throw new Error('Unexpected remote mutation: '+method);
}});
const node=saveNode({name:'Fixture',url:String(daemon.url).replace(/\/$/,''),token:'fixture'});
afterAll(()=>{daemon.stop(true);rmSync(root,{recursive:true,force:true});});
test('new identities reuse runtime infrastructure without copying another agent secret markers or access',async()=>{
 const before=JSON.stringify(template);
 await createAgent({nodeId:node.id,name:'New Agent',model:'model',requestId:'redacted-create',dryRun:true});
 expect(lastPatch.dryRun).toBe(true);
 expect(lastPatch.expectedCurrentSpecHash).toBe('v1');
 expect(lastPatch.spec.agents[0]).toEqual(template);
 expect(lastPatch.spec.agents[1]).toEqual({name:'sibling',model:'other'});
 expect(lastPatch.spec.agents[2]).toEqual({name:expect.stringMatching(/^zo-/),displayName:'New Agent',description:'',provider:'pi',model:'model',systemPrompt:'',enabled:true,
  image:template.image,driver:template.driver,sandbox:template.sandbox});
 expect(marker(lastPatch.spec.agents[2])).toBe(false);
 expect(JSON.stringify(template)).toBe(before);
});
test('an explicit image overrides the reused image and older plaintext credentials are not copied either',async()=>{
 const saved=template.env[0].value;
 template.env[0].value='legacy-plaintext-token';
 try{
  await createAgent({nodeId:node.id,name:'Other Agent',model:'model',image:'runtime:selected',requestId:'custom-image',dryRun:true});
  const created=lastPatch.spec.agents.at(-1);
  expect(created.image).toBe('runtime:selected');expect(created.env).toBeUndefined();expect(created.mcpServers).toBeUndefined();
  expect(JSON.stringify(created)).not.toContain('legacy-plaintext-token');
 }finally{template.env[0].value=saved;}
});
test('editing an existing identity retains its own redaction markers at the same native paths',async()=>{
 await editAgent({binding:{nodeId:node.id,projectId:'project',agentName:'pi'},specHash:'v1',agent:{name:'pi',displayName:'Edited Agent'},dryRun:true});
 expect(lastPatch.spec.agents[0]).toEqual({...template,displayName:'Edited Agent'});
 expect(lastPatch.spec.agents[1]).toEqual({name:'sibling',model:'other'});
 expect(lastPatch.dryRun).toBe(true);expect(patches).toBe(3);
});
