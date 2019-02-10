/**
 * Allow babel-plugin-module-resolver aliases for JetBrains IDEs
 */

System.config({
  paths: {
    '@@/*': './*',
    '@/*': './server/src/*'
  }
})
