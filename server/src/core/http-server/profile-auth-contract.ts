export const PROFILE_AUTH_BOOTSTRAP_ID = 'leon-profile-bootstrap'
export const PROFILE_AUTH_COOKIE_NAME = 'leon_profile_token'

/**
 * Public identity metadata; credentials remain in the server-validated cookie.
 */
export interface ProfileAuthentication {
  authenticated: boolean
  profile_name: string | null
}
