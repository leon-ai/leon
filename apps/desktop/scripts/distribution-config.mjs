import assert from 'node:assert/strict'
import path from 'node:path'

/**
 * Uses native installers for signed releases and a minimal directory build for
 * local experiments. Credentials are supplied by CI, never embedded in assets.
 */
export function distributionConfig({ root, staging, output, manifest, contract, diagnostics, release, channel }) {
  assert(['preview', 'stable'].includes(channel), 'Unknown desktop release channel')
  const appId = diagnostics ? `${manifest.appId}.diagnostics` : manifest.appId
  return {
    appId, productName: manifest.productName, executableName: manifest.name,
    icon: path.join(root, 'packaging/icons/light.png'),
    directories: { app: staging, output, buildResources: path.join(root, 'packaging') },
    electronVersion: manifest.devDependencies.electron,
    artifactName: 'leon-desktop-${version}-${os}-${arch}.${ext}',
    asar: true, compression: 'normal', npmRebuild: false, nodeGypRebuild: false,
    allowMissingDependencies: false,
    forceCodeSigning: release && process.platform !== 'linux',
    electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false,
      // Local macOS sessions are memory-only; ad-hoc rebuilds cannot retain a
      // stable Keychain identity. Signed releases keep OS cookie encryption.
      enableCookieEncryption: release || process.platform !== 'darwin',
      enableNodeCliInspectArguments: diagnostics, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true },
    files: ['test/bootstrap-fixture.mjs', 'src/**', 'runtime/**', 'icons/**', 'web/**', 'package.json', 'LICENSE.md', '!node_modules/**', '!**/*.map', '!**/.DS_Store'],
    publish: release ? { provider: 'generic', url: `${contract.repository}/releases/download/desktop-${channel}/` } : null,
    mac: { target: release ? ['dmg', 'zip'] : ['dir'], category: 'public.app-category.productivity',
      // macOS also derives the .app filename from the executable name.
      executableName: manifest.productName,
      icon: path.join(root, 'packaging/Leon.icon'),
      hardenedRuntime: release, gatekeeperAssess: false,
      entitlements: path.join(root, 'packaging/entitlements.mac.plist'),
      entitlementsInherit: path.join(root, 'packaging/entitlements.mac.plist'),
      notarize: release,
      identity: release ? undefined : '-',
      extendInfo: { NSMicrophoneUsageDescription: 'Let me use your microphone when you enable voice input.',
        NSCameraUsageDescription: 'Let me use your camera when you choose to share it.' } },
    win: { target: release ? ['nsis'] : ['dir'], icon: path.join(root, 'packaging/icons/icon.ico'),
      verifyUpdateCodeSignature: true, signtoolOptions: { signingHashAlgorithms: ['sha256'] } },
    nsis: { oneClick: true, perMachine: false, differentialPackage: true, deleteAppDataOnUninstall: false },
    deb: { maintainer: `${contract.author.name} <${contract.author.email}>` },
    linux: { target: release ? ['AppImage', 'deb'] : ['dir'], category: 'Utility' }
  }
}
