-- FAR-190: Add 'email' value to source_type_enum for ingest-email pipeline.
-- Approved by Myke 2026-06-23. Additive only — safe on live data.
ALTER TYPE source_type_enum ADD VALUE IF NOT EXISTS 'email';
