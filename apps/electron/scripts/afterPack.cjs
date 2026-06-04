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
const { execFileSync } = require('child_process');

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
