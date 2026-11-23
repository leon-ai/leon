// Shared by plain-Node release tools, Core and desktop bootstrap bundles.
export const RUNTIME_MANIFEST = 'leon-runtime.json'
export const RUNTIME_RELEASE_ASSET = 'leon-runtime-assets.json'
export const RUNTIME_SCHEMA_VERSION = 1
export const RUNTIME_DIRECTORY = 'runtime'
// Increment only when Core's native-client contract becomes incompatible.
export const DESKTOP_CORE_PROTOCOL_VERSION = 1
export const REQUIRED_RUNTIME_PLATFORMS = ['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64']
