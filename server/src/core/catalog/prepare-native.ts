import path from 'node:path'

/**
 * Reuses setup's managed runtimes, source dependency policy and cooldown rather
 * than maintaining a separate installer for owner-added native packages.
 */
export async function prepareNativeSource(directory: string): Promise<void> {
  const { syncNodejsSourceDependencies, syncPythonSourceDependencies } = await import('@@/scripts/setup/sync-source-dependencies')
  for (const language of ['nodejs', 'python']) {
    const source = path.join(directory, 'src', language)
    await syncNodejsSourceDependencies(source)
    await syncPythonSourceDependencies(source)
  }
}
