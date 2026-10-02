-- Cloudinary-backed site image storage. Existing rows remain local until re-uploaded from Admin.
ALTER TABLE site_images ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(32) NOT NULL DEFAULT 'local';
ALTER TABLE site_images ADD COLUMN IF NOT EXISTS storage_url TEXT;
CREATE INDEX IF NOT EXISTS site_images_provider_idx ON site_images (storage_provider);
