/**
 * Declaraciones mínimas del SDK de Google Identity Services (GIS) que
 * cargamos dinámicamente desde https://accounts.google.com/gsi/client.
 * Solo se tipa lo que usa driveSync.
 */

export interface GisTokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

export interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}

export interface GisTokenClientConfig {
  client_id: string
  scope: string
  callback: (response: GisTokenResponse) => void
  error_callback?: (error: unknown) => void
  prompt?: string
}

export interface GoogleAccountsOauth2 {
  initTokenClient: (config: GisTokenClientConfig) => GisTokenClient
  revoke: (token: string, done?: () => void) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: GoogleAccountsOauth2
      }
    }
  }
}

export {}
