-- CC-ARTIFACT-TAGGING-SPINE-1.0 — three tagging axes (IDF domain/sub-domain,
-- citation, jurisdiction) as measurable properties of the artifact corpus.
-- Additive only. APPLIED to prod 2026-08-01 as version 20260801120000 via the
-- Supabase MCP apply_migration path; this file is the VCS record. Idempotent.
--
-- Objects:
--   tagspine_geo_entity_map        entity_type='geography' → jurisdictions.id resolution.
--                                  All 270 geography entities classified:
--                                  resolved / held_ambiguous / non_jurisdictional / unmatched.
--                                  Exact, unambiguous matches only auto-resolve (the
--                                  substation_source_mentions D2 pattern); every resolved
--                                  row carries confidence + method. Ambiguous names
--                                  (Springfield, Ashburn, Georgia-state-vs-country) are HELD.
--   artifact_jurisdictions         artifact → jurisdiction with (confidence, method,
--                                  source_ref). Deliberately NOT denormalised onto
--                                  artifacts. Populated only from resolved entities via
--                                  artifact_entities (methods entity_*). The lane_scope
--                                  method (gsearch:loc-* source lanes) measured 49%
--                                  aboutness precision on a 100-row hand-check — BELOW the
--                                  90% bar — and is therefore NOT populated.
--   tagspine_subdomain_rules       deterministic D#.# derivation rules: content_regex
--                                  (parent-domain-gated keyword patterns) and lane
--                                  (source_key-scoped) kinds.
--   artifact_subdomain_candidates  STAGED sub-domain tags. NEVER written to
--                                  artifacts.ifs_subdomains without Myke sign-off
--                                  (CC-ARTIFACT-TAGGING-SPINE §6 STOP condition).
--   v_artifact_tagging_health      per-domain axis coverage + per-consumer readiness
--                                  (library_ready / jw_ready / academy_ready).
--
-- RLS enabled deny-all on all new tables (service-role only); anon/authenticated
-- additionally revoked on the tables and the view. Advisor delta: exactly 4 intended
-- rls_enabled_no_policy INFOs, no new WARN/ERROR.
--
-- Gotcha discovered while building: artifacts.ifs_subdomains is an EMPTY ARRAY '{}'
-- (not NULL) on most rows, and array_length('{}',1) is NULL — guard with
-- coalesce(cardinality(...),0), never array_length(...)=0.

create table if not exists tagspine_geo_entity_map (
  entity_id uuid primary key references entities(entity_id) on delete cascade,
  canonical_name text not null,
  normalized_name text,
  qualifier_state text,
  status text not null check (status in ('resolved','held_ambiguous','non_jurisdictional','unmatched')),
  jurisdiction_id uuid references jurisdictions(id),
  method text,
  confidence numeric,
  candidate_count integer,
  note text,
  resolved_at timestamptz not null default now(),
  constraint tagspine_gem_resolved_shape check ((status = 'resolved') = (jurisdiction_id is not null))
);

create table if not exists tagspine_subdomain_rules (
  rule_id text primary key,
  subdomain_code text not null references faraday_subdomains(subdomain_code),
  parent_domain text not null,
  kind text not null default 'content_regex' check (kind in ('content_regex','lane')),
  pattern text,
  source_key_like text,
  notes text
);

create table if not exists artifact_subdomain_candidates (
  artifact_id uuid not null references artifacts(artifact_id) on delete cascade,
  subdomain_code text not null references faraday_subdomains(subdomain_code),
  rule_id text not null references tagspine_subdomain_rules(rule_id),
  method text not null default 'keyword_v1',
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (artifact_id, subdomain_code)
);

create table if not exists artifact_jurisdictions (
  artifact_id uuid not null references artifacts(artifact_id) on delete cascade,
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  confidence numeric not null,
  method text not null,
  source_ref text,
  resolved_at timestamptz not null default now(),
  primary key (artifact_id, jurisdiction_id, method)
);
create index if not exists artifact_jurisdictions_jurisdiction_idx
  on artifact_jurisdictions (jurisdiction_id, confidence desc);

alter table tagspine_geo_entity_map enable row level security;
alter table tagspine_subdomain_rules enable row level security;
alter table artifact_subdomain_candidates enable row level security;
alter table artifact_jurisdictions enable row level security;

-- Citability contract mirrors migration 20260801091150 (match_artifacts): source_url
-- present and not a Google News RSS stub, envelope title + source (publisher) non-empty.
create or replace view v_artifact_tagging_health as
with base as (
  select a.artifact_id, a.source_type,
         coalesce(a.ifs_domains, '{}') as domains,
         (a.source_url is not null
          and a.source_url !~ 'news\.google\.com/rss'
          and coalesce(a.signal_envelope->>'title','') <> ''
          and coalesce(a.signal_envelope->>'source','') <> '') as citable,
         coalesce(cardinality(a.ifs_domains),0) > 0 as has_domain,
         coalesce(cardinality(a.ifs_subdomains),0) > 0 as has_subdomain,
         exists (select 1 from artifact_subdomain_candidates c where c.artifact_id = a.artifact_id) as has_subdomain_candidate,
         (select max(aj.confidence) from artifact_jurisdictions aj where aj.artifact_id = a.artifact_id) as jur_conf
  from artifacts a),
metrics as (
  -- '(all)' rows are computed on the un-exploded base so multi-domain artifacts are
  -- not double counted; per-domain rows explode ifs_domains.
  select '(all)'::text as ifs_domain, source_type::text as source_type, citable, has_domain,
         has_subdomain, has_subdomain_candidate, jur_conf
  from base
  union all
  select d.ifs_domain, b.source_type::text, b.citable, b.has_domain,
         b.has_subdomain, b.has_subdomain_candidate, b.jur_conf
  from base b
  cross join lateral unnest(case when cardinality(b.domains)=0 then array['(untagged)'] else b.domains end) as d(ifs_domain))
select ifs_domain, source_type,
       count(*) as artifacts,
       count(*) filter (where citable) as citable,
       count(*) filter (where has_subdomain) as subdomain_tagged,
       count(*) filter (where has_subdomain_candidate) as subdomain_candidate_staged,
       count(*) filter (where jur_conf is not null) as jurisdiction_resolved,
       count(*) filter (where jur_conf >= 0.8) as jurisdiction_ge_080,
       -- readiness predicates (one per consumer; all require citable):
       count(*) filter (where citable and has_domain and has_subdomain) as library_ready,
       count(*) filter (where citable and jur_conf >= 0.8) as jw_ready,
       count(*) filter (where citable and has_domain and has_subdomain) as academy_ready
from metrics
group by grouping sets ((ifs_domain, source_type), (ifs_domain))
order by ifs_domain, source_type nulls first;

revoke all on tagspine_geo_entity_map, tagspine_subdomain_rules,
              artifact_subdomain_candidates, artifact_jurisdictions from anon, authenticated;
revoke all on v_artifact_tagging_health from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: sub-domain derivation rules v1 (already applied live; idempotent).
-- Patterns are POSIX ERE, applied case-insensitively to left(raw_content,1500),
-- gated on the parent domain being present in artifacts.ifs_domains.
-- ---------------------------------------------------------------------------
insert into tagspine_subdomain_rules (rule_id, subdomain_code, parent_domain, kind, pattern, source_key_like, notes) values
('kw_d3_1','D3.1','D3','content_regex','interconnection (queue|request|agreement|stud(y|ies)|backlog)|grid access',null,'Interconnection Queue & Grid Access'),
('kw_d3_2','D3.2','D3','content_regex','\ymoratorium\y',null,'State Moratorium & Legislative Landscape'),
('kw_d3_3','D3.3','D3','content_regex','rate case|public (utility|service) commission|\yPUC\y|\yPSC\y|utility commission',null,'Utility Rate Cases & PUC Proceedings'),
('kw_d3_4','D3.4','D3','content_regex','transmission (line|project|buildout|corridor|upgrade)|\yFERC\y|regional transmission',null,'Transmission Buildout & FERC Policy'),
('kw_d3_5','D3.5','D3','content_regex','large.load tariff|data.center (tariff|rate class)|co.?location rule',null,'Large-Load Tariff Design'),
('kw_d18_1','D18.1','D18','content_regex','\yoppos(e|es|ed|ition|ing)\y|\yprotest\y|push(es|ed)? back|residents (fight|rally)|lawsuit (against|challenging)|petition against',null,'Project Opposition Register'),
('kw_d18_2','D18.2','D18','content_regex','(den(y|ies|ied|ial)|reject(s|ed)?|vote[sd]? (down|against)|turn(s|ed)? down|refus(es|ed)).{0,60}(permit|rezon|zoning|data cent|project|application|variance)|\ymoratorium\y',null,'Regulatory & Permitting Denial Tracking'),
('kw_d13_1','D13.1','D13','content_regex','community benefit|host (community )?agreement|\yCBA\y',null,'Community Benefits & Host Agreements'),
('kw_d13_2','D13.2','D13','content_regex','\yoppos(e|es|ed|ition|ing)\y|\yprotest\y|residents (fight|rally|push back)|grassroots',null,'Opposition Movements & Organized Groups'),
('kw_d13_3','D13.3','D13','content_regex','rezon(e|es|ed|ing)|zoning (change|amendment|request|approval|hearing|board)|site plan|special use permit|conditional use|planning commission|entitlement',null,'Local Permitting & Entitlement Strategy'),
('kw_d19_1','D19.1','D19','content_regex','tax (break|breaks|incentive|incentives|abatement|abatements|exemption|exemptions|credit|credits)',null,'State & Local Tax Incentives'),
('kw_d19_4','D19.4','D19','content_regex','\yclawback\y|(incentive|tax break).{0,50}(backlash|criticism|repeal|scrutiny)',null,'Tax Incentive Backlash & Clawback'),
('kw_d2_3','D2.3','D2','content_regex','\yUPS\y|uninterruptible power|battery energy storage|\yBESS\y',null,'UPS, Storage & Power Conditioning'),
('kw_d2_5','D2.5','D2','content_regex','\ynuclear\y|\ySMR\y|small modular reactor',null,'Nuclear & SMR Offtake'),
('kw_d2_6','D2.6','D2','content_regex','fuel cell|behind.the.(fence|meter)|gas turbine|onsite (gas|generation)',null,'Behind-the-Fence Gas & Fuel Cells'),
('kw_d2_7','D2.7','D2','content_regex','power purchase agreement|\yPPA\y|solar|wind (farm|power|energy|project)',null,'Renewables, Storage & PPAs'),
('kw_d2_8','D2.8','D2','content_regex','demand response|grid.interactive|curtail(ment|able)|flexible load',null,'Grid-Interactive Load & Demand Response'),
('kw_d7_1','D7.1','D7','content_regex','direct.to.chip|cold plate|liquid cool(ing|ed)',null,'Direct-to-Chip Liquid Cooling'),
('kw_d7_2','D7.2','D7','content_regex','immersion cool(ing|ed)',null,'Immersion Cooling'),
('kw_d7_3','D7.3','D7','content_regex','water (use|usage|consumption|stewardship)|waterless',null,'Water Use & Waterless Cooling'),
('kw_d11_1','D11.1','D11','content_regex','power purchase agreement|\yPPA\y|renewable energy (credit|procurement|deal)|clean energy (deal|procurement|purchase|agreement)|carbon.free energy',null,'Clean Energy Procurement'),
('kw_d11_3','D11.3','D11','content_regex','water (use|usage|consumption|stewardship|rights|replenish)',null,'Water Stewardship & Rights'),
('kw_d11_4','D11.4','D11','content_regex','heat recovery|waste heat|district heating',null,'Heat Recovery & Circular DC'),
('kw_d15_1','D15.1','D15','content_regex','export control|chip (ban|curb|restriction)|entity list',null,'Chip Export Controls'),
('kw_d15_2','D15.2','D15','content_regex','sovereign (AI|compute|cloud)|national (AI|compute) (strategy|program|initiative)',null,'National Compute Strategies'),
('kw_d16_2','D16.2','D16','content_regex','\yICS\y|\ySCADA\y|operational technology|OT security',null,'OT/ICS/SCADA Cybersecurity'),
('kw_d17_1','D17.1','D17','content_regex','(construction|trades|electrician).{0,40}(labor|workers?|shortage|union|apprentice)|labor shortage',null,'Construction & Skilled Trades Labor'),
('kw_d21_2','D21.2','D21','content_regex','cyber insurance',null,'Cyber Insurance & Tech E&O'),
('kw_d1_4','D1.4','D1','content_regex','\yHBM\y|high.bandwidth memory',null,'Memory (HBM & Next-Gen)'),
('kw_d1_8','D1.8','D1','content_regex','advanced packaging|CoWoS|\ysubstrate\y',null,'Advanced Packaging & Substrate'),
('lane_d23_2','D23.2','D23','lane',null,'feed:nws-alerts','NWS CAP alerts are grid/physical-disaster events by construction')
on conflict (rule_id) do nothing;
