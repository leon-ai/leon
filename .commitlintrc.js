module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-function-rules'],
  rules: {
    'scope-enum': [0],
    'function-rules/scope-enum': [
      2,
      'always',
      (parsed) => {
        const allowedScopes = ['web app', 'server', 'hotword']
        if (
          !parsed.scope ||
          allowedScopes.includes(parsed.scope) ||
          parsed.scope.startsWith('package/')
        ) {
          return [true]
        }

        return [false, `scope must be one of ${allowedScopes.join(', ')}`]
      }
    ]
  }
}
