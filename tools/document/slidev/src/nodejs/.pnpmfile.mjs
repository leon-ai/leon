const COMPATIBILITY_OVERRIDES = {
  'floating-vue': '5.2.2',
  '@unocss/vite>magic-string': '1.4.2'
}
const RELEASE_AGE_EXCLUSIONS = [
  '@iconify-json/lucide@1.2.141',
  'playwright-chromium@1.64.0',
  'playwright-core@1.64.0'
]

export const hooks = {
  /**
   * Keep Slidev's UI and source transforms compatible in managed and standalone
   * projects. Chromium installation is approved only when no build policy exists.
  */
  updateConfig(config) {
    const needsBuildPermission =
      !config.dangerouslyAllowAllBuilds &&
      Object.keys(config.allowBuilds ?? {}).length === 0

    return {
      ...config,
      overrides: { ...config.overrides, ...COMPATIBILITY_OVERRIDES },
      minimumReleaseAgeExclude: [
        ...new Set([
          ...(config.minimumReleaseAgeExclude ?? []),
          ...RELEASE_AGE_EXCLUSIONS
        ])
      ],
      ...(needsBuildPermission
        ? { allowBuilds: { 'playwright-chromium@1.64.0': true } }
        : {})
    }
  }
}
