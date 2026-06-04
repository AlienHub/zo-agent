import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT_DIR = process.cwd();
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'release']);

function fail(message: string): never {
  console.error(`[release-version] ${message}`);
  process.exit(1);
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    fail(`Failed to read ${relative(ROOT_DIR, path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findPackageJsonFiles(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;

    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      findPackageJsonFiles(path, result);
    } else if (entry === 'package.json') {
      result.push(path);
    }
  }

  return result;
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  fail('Expected a release tag argument, for example: v0.1.0');
}

const match = tag.match(/^v(\d+\.\d+\.\d+)$/);

if (!match) {
  fail(`Release tag must look like v0.1.0; received ${tag}`);
}

const expectedVersion = match[1];
const packageFiles = findPackageJsonFiles(ROOT_DIR)
  .filter((path) => !relative(ROOT_DIR, path).replaceAll('\\', '/').startsWith('apps/online-docs/'))
  .sort();

const mismatches: string[] = [];

for (const file of packageFiles) {
  const pkg = readJson(file);
  const version = pkg.version;

  if (typeof version === 'string' && version !== expectedVersion) {
    mismatches.push(`${relative(ROOT_DIR, file)} has ${version}`);
  }
}

if (mismatches.length > 0) {
  fail(`Release tag ${tag} does not match package versions:\n${mismatches.join('\n')}`);
}

console.log(`[release-version] ${tag} matches ${packageFiles.length} package files.`);
