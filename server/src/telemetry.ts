const IS_TELEMETRY_ENABLED = process.env['LEON_TELEMETRY'] === 'true'
const INSTANCE_ID = '' // TODO: read from file (leon.json > instanceID)

export class Telemetry {
  public static send(): void {
    if (IS_TELEMETRY_ENABLED) {
      // TODO
    }
  }
}
