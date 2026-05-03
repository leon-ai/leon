function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

/**
 * Merge default settings into existing settings without overwriting user values.
 */
export function mergeMissingSettings(defaultSettings, existingSettings) {
  if (!isPlainObject(defaultSettings)) {
    return isPlainObject(existingSettings) ? existingSettings : {}
  }

  if (!isPlainObject(existingSettings)) {
    return defaultSettings
  }

  const mergedSettings = { ...existingSettings }

  for (const [key, defaultValue] of Object.entries(defaultSettings)) {
    if (!Object.hasOwn(existingSettings, key)) {
      mergedSettings[key] = defaultValue
      continue
    }

    if (
      isPlainObject(defaultValue) &&
      isPlainObject(existingSettings[key])
    ) {
      mergedSettings[key] = mergeMissingSettings(
        defaultValue,
        existingSettings[key]
      )
    }
  }

  return mergedSettings
}
