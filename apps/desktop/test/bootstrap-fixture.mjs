/**
 * Supplies a local immutable archive only in explicitly diagnostic packages.
 */
export function bootstrapFixture(configuration) {
  return { asset: async () => configuration.asset }
}
