/** Reproducible local macOS package. No secret synchronization or publishing. */
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
  downloadBun,
  downloadUv,
  copySDK,
  verifySDKCopy,
  copyRipgrep,
  copyInterceptor,
  copyInterceptorBundle,
  copyPiAgentServer,
  buildSubprocessServers,
  buildWhatsAppWorker,
} from "./build/common";
const root = resolve(import.meta.dir, ".."),
  electronDir = join(root, "apps/electron");
const config = {
  rootDir: root,
  electronDir,
  platform: "darwin" as const,
  arch: "arm64" as const,
  upload: false,
  uploadLatest: false,
  uploadScript: false,
};
if (
  !existsSync(join(electronDir, "vendor/bun/bun")) ||
  execFileSync(join(electronDir, "vendor/bun/bun"), ["--version"], {
    encoding: "utf8",
  }).trim() !== "1.3.9"
)
  await downloadBun(config);
if (!existsSync(join(electronDir, "resources/bin/darwin-arm64/uv")))
  await downloadUv(config);
copySDK(config);
verifySDKCopy(config);
copyRipgrep(config);
copyInterceptor(config);
buildSubprocessServers(config);
buildWhatsAppWorker(config);
execFileSync("bun", ["run", "electron:build"], { cwd: root, stdio: "inherit" });
copyInterceptorBundle(config);
copyPiAgentServer(config);
execFileSync(
  join(root, "node_modules/.bin/electron-builder"),
  [
    "--config",
    "electron-builder.yml",
    "--mac",
    "--arm64",
    "--dir",
    "-c.mac.identity=-",
  ],
  {
    cwd: electronDir,
    stdio: "inherit",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  },
);
const app = join(electronDir, "release/mac-arm64/Zo.app");
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "inherit",
});
const version = (await Bun.file(join(electronDir, "package.json")).json())
  .version;
const stage = join(root, ".sandboxes/dmg-stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
execFileSync("/usr/bin/ditto", [app, join(stage, "Zo.app")]);
if (!existsSync(join(stage, "Applications")))
  execFileSync("/bin/ln", ["-s", "/Applications", join(stage, "Applications")]);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", join(stage, "Zo.app")], { stdio: "inherit" });
const dmg = join(electronDir, `release/Zo-${version}-arm64.dmg`);
execFileSync(
  "/usr/bin/hdiutil",
  [
    "create",
    "-volname",
    "Zo",
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ],
  { stdio: "inherit" },
);
execFileSync("/usr/bin/hdiutil", ["verify", dmg], { stdio: "inherit" });
console.log(`Installer: ${dmg}`);
