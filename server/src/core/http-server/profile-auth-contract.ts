export const PROFILE_AUTH_BOOTSTRAP_ID = 'leon-profile-bootstrap'

/**
 * Public identity metadata; credentials remain in the server-validated cookie.
 */
export interface ProfileAuthentication {
  authenticated: boolean
  profile_name: string | null
}
