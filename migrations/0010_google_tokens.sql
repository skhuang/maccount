-- Offline Drive access: store the Google refresh token (AES-GCM encrypted at
-- rest, see src/crypto.ts) plus the granted scope. Kept OUT of the general
-- binding row / CSV / admin views — read only via getGoogleTokenRow().
ALTER TABLE bindings ADD COLUMN google_refresh_token TEXT;     -- encrypted
ALTER TABLE bindings ADD COLUMN google_scope TEXT;
ALTER TABLE bindings ADD COLUMN google_token_updated_at TEXT;
