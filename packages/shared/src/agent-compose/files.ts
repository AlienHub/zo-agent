import { ComposeClient } from "./client.ts";
import { getNode, readState } from "./store.ts";
import type { SessionFile } from "../protocol/dto.ts";
export const COMPOSE_FILES_PREFIX = "/__agent_compose__/";
export function parseComposeFile(path: string) {
  if (!path.startsWith(COMPOSE_FILES_PREFIX)) return null;
  const [sessionId, ...rest] = path
    .slice(COMPOSE_FILES_PREFIX.length)
    .split("/");
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId))
    throw new Error("Invalid sandbox file reference");
  const relative = (rest[0] === "workspace" ? rest.slice(1) : rest).join("/");
  if (
    relative.length > 4096 ||
    relative.split("/").some((p) => p === "..") ||
    relative.includes("\0")
  )
    throw new Error("Invalid sandbox path");
  return { sessionId, relative };
}
const FILES_CODE = `import pathlib,json,os,stat,base64,sys
root=pathlib.Path('/workspace').resolve()
p=(root / sys.argv[1]).resolve()
if not p.is_relative_to(root): raise ValueError('path outside workspace')
if sys.argv[2]=='tree':
 count=[0]
 def scan(folder,depth=0):
  result=[]
  if depth>=8: return result
  for x in sorted(os.scandir(folder),key=lambda x:(not x.is_dir(follow_symlinks=False),x.name.lower())):
   if count[0]>=2000: break
   if x.is_symlink() or x.name in ('.git','node_modules','__pycache__','.zo-attachments'): continue
   count[0]+=1
   item={'name':x.name,'relative':str(pathlib.Path(x.path).relative_to(root)),'type':'directory' if x.is_dir(follow_symlinks=False) else 'file'}
   if item['type']=='directory': item['children']=scan(x.path,depth+1)
   else: item['size']=x.stat(follow_symlinks=False).st_size
   result.append(item)
  return result
 print(json.dumps(scan(p)))
else:
 fd=os.open(p,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  if not stat.S_ISREG(os.fstat(f.fileno()).st_mode): raise ValueError('not a regular file')
  limit=8*1024*1024 if p.suffix.lower() in ('.png','.jpg','.jpeg','.gif','.webp','.pdf') else 1024*1024
  data=f.read(limit+1)
  if len(data)>limit: raise ValueError('file exceeds preview limit')
  print(json.dumps({'data':base64.b64encode(data).decode()}))
`;
export async function sandboxTree(
  sessionPath: string,
  sessionId: string,
): Promise<SessionFile[] | null> {
  const state = readState(sessionPath);
  if (!state) return null;
  if (!state.sandboxId) return [];
  const raw = JSON.parse(
    await new ComposeClient(getNode(state.binding.nodeId)).exec(
      state.sandboxId,
      FILES_CODE,
      ["", "tree"],
    ),
  );
  const convert = (items: any[]): SessionFile[] =>
    items.map((item) => ({
      name: item.name,
      path: `${COMPOSE_FILES_PREFIX}${sessionId}/workspace/${item.relative}`,
      type: item.type,
      size: item.size,
      children: item.children ? convert(item.children) : undefined,
    }));
  return convert(raw);
}
export async function sandboxRead(
  sessionPath: string,
  relative: string,
): Promise<Buffer> {
  const state = readState(sessionPath);
  if (!state?.sandboxId) throw new Error("The remote sandbox is not ready");
  const result = JSON.parse(
    await new ComposeClient(getNode(state.binding.nodeId)).exec(
      state.sandboxId,
      FILES_CODE,
      [relative, "read"],
    ),
  );
  return Buffer.from(result.data, "base64");
}
