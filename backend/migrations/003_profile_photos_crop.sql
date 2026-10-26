-- =============================================================================
-- SIMATA (Sistem Informasi MA At-Taujih Sarang)
-- Migration 003: Profile Photos Framing / Crop Metadata (FEATURE 01A)
-- =============================================================================

ALTER TABLE profile_photos
ADD COLUMN IF NOT EXISTS crop_scale NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
ADD COLUMN IF NOT EXISTS crop_position_x NUMERIC(7, 2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS crop_position_y NUMERIC(7, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN profile_photos.crop_scale IS 'Zoom scale factor for profile avatar framing (default 1.00)';
COMMENT ON COLUMN profile_photos.crop_position_x IS 'Horizontal pan percentage offset for profile avatar framing (default 0.00)';
COMMENT ON COLUMN profile_photos.crop_position_y IS 'Vertical pan percentage offset for profile avatar framing (default 0.00)';
