-- Faraday Briefing Library — catalog table (FBL 1.0)
-- Add/edit/release briefings via Supabase dashboard; no code changes needed.

CREATE TABLE IF NOT EXISTS library_catalog_cache (
  id          text PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('theater','sector','thread','keyplayer')),
  theater     text,
  sector      text,
  thread      text,
  "group"     text,
  title       text NOT NULL,
  subtitle    text NOT NULL,
  byline      text NOT NULL CHECK (byline IN ('Mach','Gilbert')),
  updated     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'live' CHECK (status IN ('live','soon')),
  abstract    text NOT NULL DEFAULT '',
  hypothesis  text NOT NULL DEFAULT '',
  contents    jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE library_catalog_cache ENABLE ROW LEVEL SECURITY;

-- Public read — catalog is open-browse in FBL 1.0
CREATE POLICY "public read library_catalog_cache"
  ON library_catalog_cache FOR SELECT
  USING (true);

-- Service role only for writes
CREATE POLICY "service role write library_catalog_cache"
  ON library_catalog_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed — ON CONFLICT DO NOTHING so live edits are never overwritten
INSERT INTO library_catalog_cache
  (id, type, theater, sector, thread, "group", title, subtitle, byline, updated, status, abstract, hypothesis, contents, sort_order)
VALUES
  -- ——— Theater Briefings ———
  ('b-t-power','theater','power',null,null,null,'The Power Reckoning','Theater Briefing','Mach','June 2026','live',
   'The buildout has collided with the grid. Faraday''s thesis: generation, not silicon, sets the pace of the AI economy through 2029 — and the winners are already contracting around it.',
   'Power availability — not chip supply — is the binding constraint on AI capacity through 2029. Operators who secured firm generation before 2026 hold an advantage the market has not priced.',
   '["The thesis in one page","Where the constraint actually binds","The contracting playbook","Sectors & Threads in this Theater","Faraday''s Read"]',10),

  ('b-t-inference','theater','inference',null,null,null,'The Inference Economy','Theater Briefing','Mach','June 2026','live',
   'Training built the boom; inference pays for it. How the shift from training to serving reorders density, siting, and the economics of every rack.',
   'Inference workloads invert the siting logic of the training era: latency and power price beat campus scale. The next wave of builds looks nothing like the last one.',
   '["The inversion, stated plainly","Latency vs. scale economics","Who is positioned for the flip","Sectors & Threads in this Theater","Faraday''s Read"]',20),

  ('b-t-capital','theater','capital',null,null,null,'The Capital Concentration','Theater Briefing','Mach','May 2026','live',
   'A trillion-dollar buildout financed by a surprisingly short list of balance sheets. Where the capital stack is concentrating, and what breaks if it stops.',
   'The buildout''s financing has concentrated into fewer than a dozen decisive balance sheets. Concentration is the systemic risk — and the opportunity map.',
   '["The short list","Debt is doing the quiet work","Stress scenarios","Sectors & Threads in this Theater","Faraday''s Read"]',30),

  -- ——— Sector Briefings ———
  ('b-s-power-arch','sector','power','power-arch',null,null,'Power Architecture','Sector Briefing','Gilbert','June 2026','live',
   'From the substation to the rack: how power delivery architecture became a competitive weapon, and the design choices separating leaders from the queue.',
   'Power architecture decisions made at design time now determine a facility''s economic life. Retrofit costs make early HVDC and medium-voltage choices effectively irreversible.',
   '["State of the Sector","The architecture decisions that matter","Key companies","Threads Faraday follows here","Faraday''s Read"]',110),

  ('b-s-grid','sector','power','grid-reg',null,null,'Grid & Regulatory','Sector Briefing','Gilbert','June 2026','live',
   'Interconnection queues, ratepayer politics, and the regulatory proceedings quietly deciding where the next gigawatt lands.',
   'Regulatory posture has become a siting input as decisive as land and fiber. Jurisdictions are diverging fast — and the divergence is measurable.',
   '["State of the Sector","The proceedings that matter now","Key companies & agencies","Threads Faraday follows here","Faraday''s Read"]',120),

  ('b-s-cooling','sector','power','cooling',null,null,'Cooling & Water','Sector Briefing','Gilbert','June 2026','live',
   'Liquid is no longer optional. The cooling transition, the water politics underneath it, and the suppliers positioned for both.',
   'The liquid cooling transition is complete at the design level — every new AI hall assumes it. The competition has moved to serviceability and water accounting.',
   '["State of the Sector","The transition, by the numbers","Key companies","Threads Faraday follows here","Faraday''s Read"]',130),

  ('b-s-chips','sector','inference','chips',null,null,'Chips & Density','Sector Briefing','Gilbert','June 2026','live',
   'Accelerator roadmaps, rack density economics, and the packaging constraints shaping what a data hall must become.',
   'Rack density is rising faster than facility design cycles can absorb. The gap between announced silicon and deployable halls is the industry''s most underpriced tension.',
   '["State of the Sector","Roadmaps vs. reality","Key companies","Threads Faraday follows here","Faraday''s Read"]',210),

  ('b-s-orch','sector','inference','orchestration',null,null,'Orchestration & Control Plane','Sector Briefing','Gilbert','May 2026','live',
   'The software layer that decides which watts do work. Schedulers, telemetry, and the control plane land-grab.',
   'Control-plane software is consolidating toward two dominant patterns. Whoever owns the scheduler owns the margin.',
   '["State of the Sector","The consolidation pattern","Key companies","Threads Faraday follows here","Faraday''s Read"]',220),

  ('b-s-network','sector','inference','network',null,null,'Networking & Interconnect','Sector Briefing','Gilbert','May 2026','live',
   'Optics, backbones, and the interconnect buildout racing to keep clusters coherent.',
   'Optical interconnect capacity — not compute — is the quiet bottleneck in multi-site training. The backbone contracts signed this year reveal who saw it early.',
   '["State of the Sector","The bottleneck, mapped","Key companies","Threads Faraday follows here","Faraday''s Read"]',230),

  ('b-s-ma','sector','capital','ma-capital',null,null,'M&A & Capital Markets','Sector Briefing','Gilbert','June 2026','live',
   'Take-privates, infrastructure funds, and the debt structures financing the buildout — who is buying, who is exiting, and at what multiple.',
   'Data center M&A has entered its consolidation act: platform premiums are compressing while single-asset prices hold. The arbitrage window is closing.',
   '["State of the Sector","The deal ledger","Key companies & funds","Threads Faraday follows here","Faraday''s Read"]',310),

  ('b-s-hyper','sector','capital','hyperscaler',null,null,'Hyperscaler Activity','Sector Briefing','Gilbert','June 2026','live',
   'Capex signals, self-build versus lease, and what the quarterly filings actually say about the pace of the buildout.',
   'Hyperscaler capex guidance has decoupled from lease commitments — the self-build share is rising faster than disclosed. Colocation demand models built on 2024 ratios are wrong.',
   '["State of the Sector","Reading the filings","Key companies","Threads Faraday follows here","Faraday''s Read"]',320),

  ('b-s-entrants','sector','capital','new-entrants',null,null,'New Entrants','Sector Briefing','Gilbert','May 2026','live',
   'Neoclouds, sovereign builds, and the challengers converting GPU access into durable platforms — or not.',
   'The neocloud field will bifurcate within 18 months: a handful become durable platforms; the rest become asset sales. The dividing line is power tenure, not GPU count.',
   '["State of the Sector","The bifurcation test","Key companies","Threads Faraday follows here","Faraday''s Read"]',330),

  -- ——— Thread Briefings ———
  ('b-th-dlc','thread','power','cooling','Direct Liquid Cooling',null,'Direct Liquid Cooling','Thread Briefing','Gilbert','June 2026','live',
   'The Thread Faraday has followed longest: DLC''s march from exotic to default, Signal by Signal.',
   'DLC is now the default for AI halls; the remaining competition is over serviceability standards and who sets them.',
   '["The Thread so far","Recent Signals","The standards fight","Faraday''s Read"]',410),

  ('b-th-hvdc','thread','power','power-arch','HVDC',null,'HVDC','Thread Briefing','Gilbert','June 2026','live',
   'High-voltage DC distribution moves from white paper to purchase order. Who is shipping, who is piloting, who is watching.',
   'HVDC inside the facility crosses from pilot to specification in 2027 — driven by density, not efficiency.',
   '["The Thread so far","Recent Signals","Pilot-to-spec timeline","Faraday''s Read"]',420),

  ('b-th-queues','thread','power','grid-reg','Interconnection Queues',null,'Interconnection Queues','Thread Briefing','Gilbert','June 2026','live',
   'The queue is the market. What the latest cluster-study reforms actually change, and where load is quietly jumping the line.',
   'Queue reform is redistributing advantage, not reducing wait times. Co-located generation is the only reliable line-jump.',
   '["The Thread so far","Recent Signals","Reform scorecard","Faraday''s Read"]',430),

  ('b-th-neoclouds','thread','capital','new-entrants','Neoclouds',null,'Neoclouds','Thread Briefing','Gilbert','May 2026','live',
   'GPU-first challengers, their contracts, their creditors, and the tenure of their power.',
   'Neocloud creditworthiness now trades on power tenure. The debt market figured this out before the equity market did.',
   '["The Thread so far","Recent Signals","The tenure table","Faraday''s Read"]',440),

  ('b-th-optical','thread','inference','network','Optical Interconnect',null,'Optical Interconnect','Thread Briefing','Gilbert','May 2026','live',
   'Co-packaged optics, pluggable roadmaps, and the supply chain behind cluster coherence.',
   'Co-packaged optics arrives a full cycle earlier than consensus expects — the thermal math forces it.',
   '["The Thread so far","Recent Signals","Supply chain map","Faraday''s Read"]',450),

  -- ——— Key Player Briefings ———
  ('b-kp-vertiv','keyplayer',null,null,null,'kp-power','Vertiv','Key Player Briefing','Gilbert','June 2026','live',
   'The thermal-and-power pure play at the center of the liquid transition. Position, backlog, and the acquisition Faraday expects next.',
   'Vertiv''s services attach rate — not its equipment backlog — is the number that decides its next re-rating.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',510),

  ('b-kp-schneider','keyplayer',null,null,null,'kp-power','Schneider Electric','Key Player Briefing','Gilbert','June 2026','live',
   'From switchgear to software: the quiet consolidator of the electrical room, and the moves that telegraph its next play.',
   'Schneider acquires a liquid cooling company within 24 months. The Motivair pattern was the rehearsal.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',520),

  ('b-kp-eaton','keyplayer',null,null,null,'kp-power','Eaton','Key Player Briefing','Gilbert','June 2026','live',
   'Power management at buildout scale. The Boyd acquisition, the data center mix shift, and what the order book says.',
   'Eaton''s data center revenue mix crosses a threshold in 2027 that forces a segment restatement — and a re-rating.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',530),

  ('b-kp-coreweave','keyplayer',null,null,null,'kp-hyper','CoreWeave','Key Player Briefing','Gilbert','June 2026','live',
   'The neocloud that graduated. Contract structure, debt stack, and whether the model survives contact with inference economics.',
   'CoreWeave''s moat is its contracted power pipeline, not its GPU fleet. The market still prices the wrong asset.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',540),

  ('b-kp-equinix','keyplayer',null,null,null,'kp-colo','Equinix','Key Player Briefing','Gilbert','May 2026','live',
   'The interconnection incumbent navigating an AI cycle built for someone else''s product. The xScale bet, examined.',
   'Equinix''s retail interconnection franchise is insulated from the AI cycle — but xScale''s returns depend on a leasing market that is thinning.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',550),

  ('b-kp-digital','keyplayer',null,null,null,'kp-colo','Digital Realty','Key Player Briefing','Gilbert','May 2026','live',
   'Scale, land banks, and the funding machine. How the largest landlord in the sector is positioned for the density era.',
   'Digital Realty''s land-and-power bank is worth more than its developed portfolio implies — the JV structures are how it gets monetized.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',560),

  ('b-kp-nvidia','keyplayer',null,null,null,'kp-hyper','NVIDIA','Key Player Briefing','Gilbert','June 2026','live',
   'The company that sets everyone else''s roadmap. Allocation politics, the systems pivot, and the customer-turned-competitor question.',
   'NVIDIA''s move down the stack into systems and power reference designs is a margin defense, not an expansion — and it reshapes the vendor map either way.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',570),

  ('b-kp-microsoft','keyplayer',null,null,null,'kp-hyper','Microsoft','Key Player Briefing','Gilbert','June 2026','live',
   'The most legible hyperscaler. Lease pullbacks, self-build acceleration, and what Redmond''s siting choices reveal about the demand curve.',
   'Microsoft''s 2026 lease rationalization is a mix shift, not a demand signal — but the colocation market is trading it as demand.',
   '["Company profile","Strategic positioning","Capital & operational posture","Velocity Play hypothesis","Faraday''s Read"]',580),

  -- ——— Coming Soon ———
  ('b-cs-1','thread','power','power-arch','On-Site Generation',null,'On-Site Generation','Thread Briefing','Gilbert','','soon',
   'Gas turbines, fuel cells, and small modular hopes: the behind-the-fence generation Thread.','','[]',600),

  ('b-cs-2','thread','inference','chips','Advanced Packaging',null,'Advanced Packaging','Thread Briefing','Gilbert','','soon',
   'CoWoS capacity, substrate politics, and the packaging step that gates every roadmap.','','[]',610),

  ('b-cs-3','keyplayer',null,null,null,'kp-colo','Vantage Data Centers','Key Player Briefing','Gilbert','','soon',
   'The private hyperscale developer and its capital machine.','','[]',620),

  ('b-cs-4','keyplayer',null,null,null,'kp-power','GE Vernova','Key Player Briefing','Gilbert','','soon',
   'Turbines, grid gear, and the order book of the power reckoning.','','[]',630),

  ('b-cs-5','thread','capital','ma-capital','Infrastructure Funds',null,'Infrastructure Funds','Thread Briefing','Gilbert','','soon',
   'The permanent-capital vehicles reshaping who owns the buildout.','','[]',640),

  ('b-cs-6','sector','power','grid-reg',null,null,'Jurisdiction Watch: ERCOT','Sector Briefing','Gilbert','','soon',
   'The Texas grid, large-load rules, and the jurisdiction moving fastest.','','[]',650)

ON CONFLICT (id) DO NOTHING;
