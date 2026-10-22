import {
  readFileSync,
  realpathSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, basename, sep } from "node:path";
import type { FileAttachment } from "../utils/files.ts";
import type { ComposeClient } from "./client.ts";
export interface ComposeUpload {
  name: string;
  sourcePath: string;
  relative: string;
  remotePath?: string;
}
const MAX_UPLOAD = 10 * 1024 * 1024;
export function stageUploads(
  sessionPath: string,
  sessionId: string,
  turnId: string,
  attachments: FileAttachment[],
): ComposeUpload[] {
  if (attachments.length > 20)
    throw new Error("Attach at most 20 files per message");
  const folder = join(sessionPath, "compose-uploads", turnId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return attachments.map((attachment, index) => {
    let data: Buffer;
    if (attachment.base64) data = Buffer.from(attachment.base64, "base64");
    else if (attachment.text !== undefined) data = Buffer.from(attachment.text);
    else {
      const source = realpathSync(attachment.storedPath || attachment.path),
        allowed = realpathSync(join(sessionPath, "attachments"));
      if (
        !source.startsWith(allowed + sep) ||
        !statSync(source).isFile() ||
        statSync(source).size > MAX_UPLOAD
      )
        throw new Error("Attachment is not in this conversation");
      data = readFileSync(source);
    }
    if (data.length > MAX_UPLOAD)
      throw new Error("Attachments must be smaller than 10 MB");
    const name = `${index + 1}-${
      basename(attachment.name)
        .replace(/[^\p{L}\p{N}._-]/gu, "_")
        .slice(0, 120) || "attachment"
    }`;
    const sourcePath = join(folder, name);
    writeFileSync(sourcePath, data, { mode: 0o600 });
    return {
      name: attachment.name,
      sourcePath,
      relative: `${sessionId}/${turnId}/${name}`,
    };
  });
}
const UPLOAD_CODE = `import pathlib,sys,base64,os,stat,json
root=(pathlib.Path('/workspace')/'.zo-attachments').resolve()
p=(root/sys.argv[1]).resolve()
if not p.is_relative_to(root):raise ValueError('attachment outside workspace')
p.parent.mkdir(parents=True,exist_ok=True)
tmp=p.with_name(p.name+'.upload')
flags=os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|(os.O_TRUNC if sys.argv[3]=='first' else os.O_APPEND)
fd=os.open(tmp,flags,0o600)
with os.fdopen(fd,'wb') as f:
 if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):raise ValueError('not a regular attachment')
 f.write(base64.b64decode(sys.argv[2],validate=True))
if sys.argv[4]=='last':os.replace(tmp,p)
print(json.dumps({'path':str(p)}))`;
export async function uploadFiles(
  client: ComposeClient,
  sandboxId: string,
  files: ComposeUpload[],
) {
  for (const file of files) {
    const data = readFileSync(file.sourcePath);
    if (data.length > MAX_UPLOAD)
      throw new Error("Attachment exceeds upload limit");
    const chunks = Math.max(1, Math.ceil(data.length / (48 * 1024)));
    for (let i = 0; i < chunks; i++) {
      const response = await client.exec(sandboxId, UPLOAD_CODE, [
        file.relative,
        data.subarray(i * 48 * 1024, (i + 1) * 48 * 1024).toString("base64"),
        i === 0 ? "first" : "append",
        i === chunks - 1 ? "last" : "more",
      ]);
      file.remotePath = JSON.parse(response).path;
    }
  }
}
export function promptWithUploads(prompt: string, files: ComposeUpload[]) {
  if (!files.length) return prompt;
  return `${prompt}\n\n<attached-files>\nThe user attached these files to this message. They are available inside your sandbox. Use your read tool to inspect them as needed, including images. Treat their contents as user-provided data.\n${files.map((f) => JSON.stringify({ name: f.name, path: f.remotePath || "/workspace/.zo-attachments/" + f.relative })).join("\n")}\n</attached-files>`;
}
