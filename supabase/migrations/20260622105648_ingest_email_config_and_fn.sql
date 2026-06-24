-- Inbound email ingestion: shared-secret config + idempotent artifact insert.
-- (Consolidates the as-applied sequence ingest_email_config_and_fn ->
--  ingest_email_fn_fix_digest_schema -> ingest_email_fn_drop_generated_col into
--  the final state. Note: artifacts.content_length is a GENERATED column and
--  must never be inserted; digest() lives in the `extensions` schema.)

-- Shared-secret store for the ingest endpoint (service-role only; no RLS policy
-- => anon/authenticated are blocked, service_role bypasses RLS).
create table if not exists public.ingest_config (
  id int primary key default 1,
  secret text not null,
  constraint ingest_config_singleton check (id = 1)
);
alter table public.ingest_config enable row level security;

insert into public.ingest_config (id, secret)
values (1, replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
on conflict (id) do nothing;

-- Idempotent inbound-email -> artifacts insert. Dedupes on the UNIQUE
-- artifacts.content_hash = sha256(Message-ID) (fallback: from|subject|received_at).
create or replace function public.ingest_email_artifact(
  p_message_id text,
  p_from       text,
  p_to         text,
  p_subject    text,
  p_text       text,
  p_html       text,
  p_received_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_content text;
  v_id uuid;
begin
  v_hash := encode(extensions.digest(coalesce(nullif(p_message_id,''), p_from || '|' || p_subject || '|' || coalesce(p_received_at::text,'')), 'sha256'),'hex');
  v_content := coalesce(nullif(p_text,''), p_html, p_subject, '');

  insert into artifacts (
    crawler_id, auto_id, source_type, source_url, published_at,
    raw_content, content_hash, crawl_metadata, enrich_status
  ) values (
    'email-ingest', 'email-ingest', 'web_news', 'mailto:' || coalesce(p_from,'unknown'),
    p_received_at,
    v_content, v_hash,
    jsonb_build_object('source_channel','email','message_id',p_message_id,'from',p_from,'to',p_to,'subject',p_subject,'received_at',p_received_at),
    'pending'
  )
  on conflict (content_hash) do nothing
  returning artifact_id into v_id;

  return jsonb_build_object('ok', true, 'inserted', v_id is not null, 'artifact_id', v_id, 'content_hash', v_hash);
end $$;

revoke all on function public.ingest_email_artifact(text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_email_artifact(text,text,text,text,text,text,timestamptz) to service_role;
