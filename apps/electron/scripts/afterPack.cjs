/**
 * electron-builder afterPack hook
 *
 * Bundles runtime dependencies that electron-builder cannot safely collect from
 * the monorepo root, then copies the pre-compiled macOS 26+ Liquid Glass icon
 * (Assets.car) into the app bundle. The Assets.car file is compiled locally
 * using actool with the macOS 26 SDK (not available in CI), then committed to
 * the repo.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BUN_VERSION = 'bun-v1.3.9';

function copyDir(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
}

function normalizeArch(arch) {
  if (arch === 'arm64' || arch === 3) return 'arm64';
  if (arch === 'x64' || arch === 1) return 'x64';
  throw new Error(`Unsupported Electron build arch: ${arch}`);
}

function sdkBinaryPackage(platform, arch) {
  if (platform === 'darwin') return `claude-agent-sdk-darwin-${arch}`;
  if (platform === 'win32') return `claude-agent-sdk-win32-${arch}`;
  if (platform === 'linux') return `claude-agent-sdk-linux-${arch}`;
  throw new Error(`Unsupported Electron platform: ${platform}`);
}

function nativeBinaryName(platform) {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

function bunBinaryName(platform) {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

function bunDownloadName(platform, arch) {
  if (platform === 'darwin') return `bun-darwin-${arch === 'arm64' ? 'aarch64' : 'x64'}`;
  if (platform === 'win32') return 'bun-windows-x64-baseline';
  if (platform === 'linux') return `bun-linux-${arch === 'arm64' ? 'aarch64' : 'x64-baseline'}`;
  throw new Error(`Unsupported Electron platform for Bun: ${platform}`);
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extractZip(zipPath, destination, platform) {
  fs.mkdirSync(destination, { recursive: true });
  if (platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'inherit' });
    return;
  }

  execFileSync('unzip', ['-o', zipPath, '-d', destination], { stdio: 'inherit' });
}

function ensureSdkBinaryPackage(rootDir, packageName) {
  const source = path.join(rootDir, 'node_modules', '@anthropic-ai', packageName);
  if (fs.existsSync(source)) return source;

  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const sdkVersion = rootPkg.dependencies && rootPkg.dependencies['@anthropic-ai/claude-agent-sdk'];
  if (!sdkVersion) {
    throw new Error('Unable to resolve @anthropic-ai/claude-agent-sdk version from root package.json');
  }

  console.log(`afterPack: ${packageName} missing from node_modules, fetching from npm...`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-sdk-'));
  try {
    execFileSync('npm', ['pack', `@anthropic-ai/${packageName}@${sdkVersion}`], {
      cwd: tempDir,
      stdio: 'inherit',
    });
    const tarball = fs.readdirSync(tempDir).find((entry) => entry.endsWith('.tgz'));
    if (!tarball) throw new Error(`npm pack did not produce a tarball for ${packageName}`);

    execFileSync('tar', ['-xzf', tarball], { cwd: tempDir, stdio: 'inherit' });
    fs.mkdirSync(source, { recursive: true });
    fs.cpSync(path.join(tempDir, 'package'), source, { recursive: true, dereference: true });
    return source;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function getResourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const productFilename = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources');
  }

  return path.join(context.appOutDir, 'resources');
}

async function downloadBunRuntime(platform, arch) {
  const bunDownload = bunDownloadName(platform, arch);
  const binaryName = bunBinaryName(platform);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-bun-'));
  const zipPath = path.join(tempDir, `${bunDownload}.zip`);
  const shasumsPath = path.join(tempDir, 'SHASUMS256.txt');

  try {
    const zipUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${bunDownload}.zip`;
    const shasumsUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt`;

    console.log(`afterPack: downloading Bun ${BUN_VERSION} (${bunDownload})`);
    await downloadFile(zipUrl, zipPath);
    await downloadFile(shasumsUrl, shasumsPath);

    const expected = fs.readFileSync(shasumsPath, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.includes(`${bunDownload}.zip`))
      ?.trim()
      .split(/\s+/)[0];
    if (!expected) {
      throw new Error(`Bun checksum not found for ${bunDownload}.zip`);
    }

    const actual = sha256(zipPath);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Bun checksum mismatch for ${bunDownload}.zip`);
    }

    extractZip(zipPath, tempDir, platform);

    const binaryPath = path.join(tempDir, bunDownload, binaryName);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Bun binary missing after extraction: ${binaryPath}`);
    }
    if (platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    return { binaryPath, tempDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function koffiPlatformDir(platform, arch) {
  return `${platform}_${arch}`;
}

function copyKoffiForTarget(rootDir, destDir, platform, arch) {
  const source = path.join(rootDir, 'node_modules', 'koffi');
  if (!fs.existsSync(source)) {
    throw new Error(`koffi package not found at ${source}. Run bun install first.`);
  }

  const dest = path.join(destDir, 'node_modules', 'koffi');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of ['package.json', 'index.js', 'indirect.js', 'index.d.ts', 'lib']) {
    const src = path.join(source, entry);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(dest, entry), { recursive: true, dereference: true });
    }
  }

  const targetDir = koffiPlatformDir(platform, arch);
  const nativeSrc = path.join(source, 'build', 'koffi', targetDir);
  const nativeDest = path.join(dest, 'build', 'koffi', targetDir);
  if (!fs.existsSync(nativeSrc)) {
    throw new Error(`koffi native binary not found for ${targetDir} at ${nativeSrc}`);
  }

  fs.mkdirSync(nativeDest, { recursive: true });
  fs.cpSync(nativeSrc, nativeDest, { recursive: true, dereference: true });
  console.log(`afterPack: koffi native module bundled (${targetDir})`);
}

function bundleHelperServers(context) {
  const platform = context.electronPlatformName;
  const arch = normalizeArch(context.arch);
  const electronDir = context.packager.projectDir;
  const rootDir = path.resolve(electronDir, '..', '..');
  const appDir = path.join(getResourcesDir(context), 'app');

  const sessionSource = path.join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const sessionDest = path.join(appDir, 'resources', 'session-mcp-server', 'index.js');
  if (!fs.existsSync(sessionSource)) {
    throw new Error(`Session MCP server build output missing: ${sessionSource}`);
  }
  fs.mkdirSync(path.dirname(sessionDest), { recursive: true });
  fs.copyFileSync(sessionSource, sessionDest);
  console.log('afterPack: session MCP server bundled');

  const piSource = path.join(rootDir, 'packages', 'pi-agent-server', 'dist', 'index.js');
  const piDestDir = path.join(appDir, 'resources', 'pi-agent-server');
  const piDest = path.join(piDestDir, 'index.js');
  if (!fs.existsSync(piSource)) {
    throw new Error(`Pi agent server build output missing: ${piSource}`);
  }
  fs.rmSync(piDestDir, { recursive: true, force: true });
  fs.mkdirSync(piDestDir, { recursive: true });
  fs.copyFileSync(piSource, piDest);
  copyKoffiForTarget(rootDir, piDestDir, platform, arch);
  console.log('afterPack: Pi agent server bundled');
}

async function bundleBunRuntime(context) {
  const platform = context.electronPlatformName;
  const arch = normalizeArch(context.arch);
  const electronDir = context.packager.projectDir;
  const appDir = path.join(getResourcesDir(context), 'app');
  const binaryName = bunBinaryName(platform);
  const existing = path.join(electronDir, 'vendor', 'bun', binaryName);
  const canUseExisting = fs.existsSync(existing) && process.platform === platform && process.arch === arch;
  const downloaded = canUseExisting
    ? undefined
    : await downloadBunRuntime(platform, arch);
  const source = canUseExisting ? existing : downloaded.binaryPath;
  const dest = path.join(appDir, 'vendor', 'bun', binaryName);

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    if (platform !== 'win32') {
      fs.chmodSync(dest, 0o755);
    }
  } finally {
    if (downloaded) {
      fs.rmSync(downloaded.tempDir, { recursive: true, force: true });
    }
  }

  const size = fs.statSync(dest).size;
  if (size < 10_000_000) {
    throw new Error(`Bundled Bun binary is unexpectedly small (${size} bytes): ${dest}`);
  }
  console.log(`afterPack: Bun runtime bundled (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

function bundleRuntimeDependencies(context) {
  const platform = context.electronPlatformName;
  const arch = normalizeArch(context.arch);
  const electronDir = context.packager.projectDir;
  const rootDir = path.resolve(electronDir, '..', '..');
  const appDir = path.join(getResourcesDir(context), 'app');

  console.log(`afterPack: bundling runtime dependencies for ${platform}-${arch}`);

  const sdkCoreSource = path.join(rootDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
  if (!fs.existsSync(sdkCoreSource)) {
    throw new Error(`SDK core not found at ${sdkCoreSource}. Run bun install first.`);
  }

  copyDir(
    sdkCoreSource,
    path.join(appDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
  );

  const binaryPackage = sdkBinaryPackage(platform, arch);
  const sdkBinarySource = ensureSdkBinaryPackage(rootDir, binaryPackage);
  const sdkBinaryDest = path.join(appDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-binary');
  copyDir(sdkBinarySource, sdkBinaryDest);

  const binaryPath = path.join(sdkBinaryDest, nativeBinaryName(platform));
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`SDK native binary missing after copy: ${binaryPath}`);
  }
  const binarySize = fs.statSync(binaryPath).size;
  if (binarySize < 50_000_000) {
    throw new Error(`SDK native binary is too small (${binarySize} bytes): ${binaryPath}`);
  }
  if (platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755);
  }
  console.log(`afterPack: SDK native binary bundled (${(binarySize / 1024 / 1024).toFixed(1)} MB)`);

  const rgSource = path.join(rootDir, 'node_modules', '@vscode', 'ripgrep');
  const rgBinary = path.join(rgSource, 'bin', platform === 'win32' ? 'rg.exe' : 'rg');
  if (!fs.existsSync(rgBinary)) {
    throw new Error(`ripgrep binary not found at ${rgBinary}. Run bun install and ensure postinstall scripts ran.`);
  }

  copyDir(rgSource, path.join(appDir, 'node_modules', '@vscode', 'ripgrep'));
  console.log('afterPack: ripgrep bundled');
}

module.exports = async function afterPack(context) {
  bundleRuntimeDependencies(context);
  bundleHelperServers(context);
  await bundleBunRuntime(context);

  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const resourcesDir = getResourcesDir(context);
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};
