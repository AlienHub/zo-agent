#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "bun";

interface Args {
  profile: string;
  port?: string;
  reset: boolean;
  configDir?: string;
  workspaceDir?: string;
  terminal: boolean;
  dryRun: boolean;
  help: boolean;
}

interface WorkspaceEntry {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  createdAt: number;
}

interface StoredConfig {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  [key: string]: unknown;
}

const ROOT_DIR = join(import.meta.dir, "..");
const ISOLATED_ROOT = join(ROOT_DIR, ".dev", "electron-isolated");
const PERMISSION_MODES = ["safe", "ask", "allow-all"];

function printHelp(): void {
  console.log(`Usage: bun run electron:dev:isolated [options]

Launch an Electron dev client with isolated app config and workspace data.

Options:
  --profile <name>       Isolated profile name (default: isolated)
  --port <port>          Vite dev server port (default: stable per profile)
  --config-dir <path>    Override isolated CRAFT_CONFIG_DIR
  --workspace-dir <path> Override isolated workspace root
  --reset                Delete this isolated profile before launching
  --terminal             Open a macOS Terminal window and launch there
  --dry-run              Prepare isolated files and print env without launching
  -h, --help             Show this help

Examples:
  bun run electron:dev:isolated
  bun run electron:dev:isolated --profile qa --port 6201
  bun run electron:dev:isolated --profile qa --reset
  bun run electron:dev:isolated --profile qa --terminal
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { profile: "isolated", reset: false, terminal: false, dryRun: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--reset") {
      args.reset = true;
    } else if (arg === "--terminal") {
      args.terminal = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--profile" || arg === "--name") {
      if (!next) throw new Error(`${arg} requires a value`);
      args.profile = next;
      i++;
    } else if (arg === "--port") {
      if (!next) throw new Error("--port requires a value");
      args.port = next;
      i++;
    } else if (arg === "--config-dir") {
      if (!next) throw new Error("--config-dir requires a value");
      args.configDir = next;
      i++;
    } else if (arg === "--workspace-dir") {
      if (!next) throw new Error("--workspace-dir requires a value");
      args.workspaceDir = next;
      i++;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug || "isolated";
}

function schemeSuffix(value: string): string {
  const suffix = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return suffix || "isolated";
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i++) {
    result = (result * 31 + value.charCodeAt(i)) >>> 0;
  }
  return result;
}

function defaultPort(profile: string): string {
  return String(6200 + (hash(profile) % 1000));
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function launchInTerminal(args: Args): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("--terminal is currently supported on macOS only");
  }

  const commandParts = [
    "cd",
    shellQuote(ROOT_DIR),
    "&&",
    "bun",
    "run",
    "scripts/electron-dev-isolated.ts",
    "--profile",
    shellQuote(args.profile),
  ];

  if (args.port) commandParts.push("--port", shellQuote(args.port));
  if (args.configDir) commandParts.push("--config-dir", shellQuote(args.configDir));
  if (args.workspaceDir) commandParts.push("--workspace-dir", shellQuote(args.workspaceDir));
  if (args.reset) commandParts.push("--reset");
  if (args.dryRun) commandParts.push("--dry-run");

  const command = commandParts.join(" ");
  const script = `tell application "Terminal" to do script ${appleScriptString(command)}`;
  const proc = spawn({
    cmd: ["osascript", "-e", script],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to open Terminal launcher (exit ${exitCode})`);
  }
}

function ensureWorkspace(workspaceRoot: string, profile: string): WorkspaceEntry {
  const now = Date.now();
  const slug = slugify(profile);
  const workspaceName = `Isolated ${profile}`;
  const workspaceId = `ws_iso_${hash(`${workspaceRoot}:${profile}`).toString(36).slice(0, 8)}`;
  const dataDir = join(workspaceRoot, ".zo");

  mkdirSync(join(dataDir, "sources"), { recursive: true });
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  mkdirSync(join(dataDir, "skills"), { recursive: true });

  const workspaceConfigPath = join(dataDir, "config.json");
  if (!existsSync(workspaceConfigPath)) {
    writeJson(workspaceConfigPath, {
      id: workspaceId,
      name: workspaceName,
      slug,
      defaults: {
        enabledSourceSlugs: [],
        permissionMode: "ask",
        cyclablePermissionModes: PERMISSION_MODES,
        workingDirectory: workspaceRoot,
      },
      localMcpServers: {
        enabled: true,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    id: workspaceId,
    name: workspaceName,
    slug,
    rootPath: workspaceRoot,
    createdAt: now,
  };
}

function ensureConfig(configDir: string, workspace: WorkspaceEntry): void {
  mkdirSync(configDir, { recursive: true });

  const configPath = join(configDir, "config.json");
  const existing = readJson<StoredConfig>(configPath);
  if (existing) {
    const prior = Array.isArray(existing.workspaces) ? existing.workspaces : [];
    // Dedup by the stable, deterministic id — NOT rootPath. This launcher writes
    // an absolute rootPath, but the app re-persists it in ~-tilde form, so a
    // raw rootPath comparison never matched and a fresh copy was appended on
    // every launch (same id, N rows in the UI). Collapse any prior copies of
    // this workspace (by id OR either rootPath form) and re-add a single entry,
    // preserving app-added fields from the first match.
    const match = prior.find((e) => e.id === workspace.id || e.rootPath === workspace.rootPath);
    const others = prior.filter((e) => e.id !== workspace.id && e.rootPath !== workspace.rootPath);
    const merged = match
      ? { ...match, name: workspace.name, slug: workspace.slug, rootPath: workspace.rootPath }
      : workspace;
    existing.workspaces = [...others, merged];
    existing.activeWorkspaceId = existing.activeWorkspaceId || merged.id;
    existing.activeSessionId = existing.activeSessionId ?? null;
    writeJson(configPath, existing);
    return;
  }

  writeJson(configPath, {
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: null,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.terminal) {
    await launchInTerminal(args);
    return;
  }

  const profile = slugify(args.profile);
  const profileRoot = join(ISOLATED_ROOT, profile);
  const configDir = resolve(args.configDir ?? join(profileRoot, "config"));
  const workspaceRoot = resolve(args.workspaceDir ?? join(profileRoot, "workspace"));
  const port = args.port ?? defaultPort(profile);

  if (!/^\d+$/.test(port)) {
    throw new Error(`Invalid port: ${port}`);
  }

  if (args.reset) {
    rmSync(profileRoot, { recursive: true, force: true });
  }

  const workspace = ensureWorkspace(workspaceRoot, profile);
  ensureConfig(configDir, workspace);

  const env = {
    ...(process.env as Record<string, string>),
    CRAFT_CONFIG_DIR: configDir,
    CRAFT_VITE_PORT: port,
    CRAFT_APP_NAME: `Zo [${profile}]`,
    CRAFT_DEEPLINK_SCHEME: `craftagents${schemeSuffix(profile)}`,
  };

  console.log("Starting isolated Electron dev client:");
  console.log(`  profile:       ${profile}`);
  console.log(`  config dir:    ${configDir}`);
  console.log(`  workspace dir: ${workspaceRoot}`);
  console.log(`  vite port:     ${port}`);
  console.log(`  app name:      ${env.CRAFT_APP_NAME}`);
  console.log("");

  if (args.dryRun) {
    console.log("Dry run complete; Electron was not launched.");
    return;
  }

  const proc = spawn({
    cmd: ["bun", "run", "scripts/electron-dev.ts"],
    cwd: ROOT_DIR,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
