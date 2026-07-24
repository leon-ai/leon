const REDACTED_VALUE = '***'
const SENSITIVE_KEY_PARTS = [
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'privatekey',
  'clientsecret',
  'accesstoken',
  'refreshtoken'
]

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export class JsonRedactionHelper {
  /**
   * Whether a JSON key should be treated as sensitive.
   */
  public static isSensitiveKey(key: string): boolean {
    const normalizedKey = normalizeKey(key)

    return SENSITIVE_KEY_PARTS.some((sensitiveKeyPart) =>
      normalizedKey.includes(sensitiveKeyPart)
    )
  }

  /**
   * Recursively redact sensitive values from JSON-compatible data.
   */
  public static redactSensitiveValues(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitiveValues(item))
    }

    if (!value || typeof value !== 'object') {
      return value
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        this.isSensitiveKey(key)
          ? REDACTED_VALUE
          : this.redactSensitiveValues(item)
      ])
    )
  }
}
