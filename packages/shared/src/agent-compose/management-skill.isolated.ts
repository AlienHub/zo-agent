import {afterAll,expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'zo-management-skill-'));
process.env.CRAFT_CONFIG_DIR=join(root,'config');
const {setBundledAssetsRoot}=await import('../utils/paths.ts');
setBundledAssetsRoot(resolve('apps/electron'));
const {loadAllSkills,loadSkillBySlug,invalidateSkillsCache}=await import('../skills/storage.ts');
const {permissionsConfigCache,ensureDefaultPermissions}=await import('../agent/permissions-config.ts');
const {getWorkspaceSkillsPath}=await import('../workspaces/storage.ts');
ensureDefaultPermissions();
const {isReadOnlyBashCommandWithConfig}=await import('../agent/mode-manager.ts');
afterAll(()=>rmSync(root,{recursive:true,force:true}));
test('bundled management skill is discoverable without copying into user workspaces and respects user override',()=>{
 const workspace=join(root,'workspace');
 const skill=loadSkillBySlug(workspace,'agent-compose');
 expect(skill?.source).toBe('builtin');expect(loadAllSkills(workspace).some(s=>s.slug==='agent-compose')).toBe(true);
 expect(skill?.path).toContain('resources/skills');
 mkdirSync(join(getWorkspaceSkillsPath(workspace),'agent-compose'),{recursive:true});
 writeFileSync(join(getWorkspaceSkillsPath(workspace),'agent-compose/SKILL.md'),'---\nname: User Override\ndescription: User customization\n---\nCustom instructions');
 invalidateSkillsCache();expect(loadSkillBySlug(workspace,'agent-compose')?.source).toBe('workspace');
 expect(loadAllSkills(workspace).filter(s=>s.slug==='agent-compose')).toHaveLength(1);
});
test('Explore permits read management but blocks writes, shell chains and environment overrides',()=>{
 const config=permissionsConfigCache.getMergedConfig({workspaceRootPath:root,activeSourceSlugs:[]});
 expect(isReadOnlyBashCommandWithConfig('zo-compose servers',config)).toBe(true);
 expect(isReadOnlyBashCommandWithConfig('zo-compose read node -- project ls',config)).toBe(true);
 expect(isReadOnlyBashCommandWithConfig('zo-compose write node -- sandbox stop id',config)).toBe(false);
 expect(isReadOnlyBashCommandWithConfig('zo-compose read node -- project ls; touch /tmp/unsafe',config)).toBe(false);
 expect(isReadOnlyBashCommandWithConfig('CRAFT_AGENT_COMPOSE_BINARY=/tmp/fake zo-compose read node -- project ls',config)).toBe(false);
});

test('native child processes discover the same built-in skill through the exported resource root',async()=>{
 const program=`import {loadSkillBySlug} from ${JSON.stringify(resolve('packages/shared/src/skills/storage.ts'))};const skill=loadSkillBySlug('/tmp/unused','agent-compose');console.log(JSON.stringify({source:skill?.source,path:skill?.path}));`;
 const child=Bun.spawn([process.execPath,'-e',program],{cwd:root,env:process.env,stdout:'pipe',stderr:'pipe'});
 const result=JSON.parse(await new Response(child.stdout).text());
 expect(await child.exited).toBe(0);expect(result.source).toBe('builtin');
});
