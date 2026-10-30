import { PROFILE_AUTH_BOOTSTRAP_ID, type ProfileAuthentication } from './profile-auth-contract'

/**
 * Places only public, request-validated identity metadata before app startup.
 * Escaping '<' prevents profile names from terminating the inert JSON element.
 */
export function renderWebAppDocument(html: string, auth: ProfileAuthentication): string {
  const json = JSON.stringify({
    authenticated: auth.authenticated,
    profile_name: auth.profile_name
  }).replaceAll('<', '\\u003c')

  return html.replace('</head>', `<script id="${PROFILE_AUTH_BOOTSTRAP_ID}" type="application/json">${json}</script></head>`)
}
