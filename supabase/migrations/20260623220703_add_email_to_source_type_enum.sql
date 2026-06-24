-- Add 'email' to source_type_enum so inbound email artifacts (ingest@ streams and
-- forward@ Gmail forwards, crawler_id=ingest-email_v1.0) carry source_type='email'.
alter type public.source_type_enum add value if not exists 'email';
