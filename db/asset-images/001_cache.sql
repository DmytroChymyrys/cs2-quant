-- Optional imagery only; no market/collector tables are altered.
CREATE TABLE IF NOT EXISTS asset_image_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
