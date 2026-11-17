import { setupProfile } from '@@/scripts/setup/setup-profile'

// The compiled entry point uses the ordinary profile flow with bundled packages.
setupProfile({ installDependencies: false }).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
