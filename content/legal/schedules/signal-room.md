---
title: Schedule SR — Signal Room
docId: schedule-signal-room
storefront: Signal Room
domain: "TODO(myke): confirm the production domain for Signal Room."
version: 1.0-draft
status: DRAFT
effective: "TODO(myke): set on counsel clearance, together with the Master Terms."
canonicalUrl: https://faraday-intelligence.ai/terms/signal-room
masterUrl: https://faraday-intelligence.ai/terms
owningRepo: "Mykemiller/Faraday-Signal-Room (not reachable from the session that drafted this — see docs/legal/DISCOVERY.md)"
---

This Schedule governs **Signal Room**, Faraday's signal configurator and
monitoring surface.

**The Faraday Intelligence Master Terms of Service are incorporated into this
Schedule by reference and apply in full.** This Schedule adds terms specific to
Signal Room. Where this Schedule conflicts with the Master Terms, this Schedule
controls for Signal Room only, and only to the extent of the conflict. Capitalised
terms not defined here have the meaning given in the Master Terms.

## SR-1. What Signal Room produces

Signal Room lets you configure parameters — geography, sector, threshold,
timeframe, and similar inputs — and returns **configurator output**: a set of
signals, matches, rankings, or alerts assembled from Faraday's corpus and scoring
layer against the configuration you supplied.

Configurator output is **generated on demand from your inputs**. It is not a
curated, pre-reviewed publication, and it is not a research report. Two
configurations that look similar may return materially different output.

## SR-2. Configurator output is licensed to you, not sold

Configurator output is Faraday content under Section 4 of the Master Terms.
Subject to your subscription, you may use configurator output **internally, for
your own decisions, on the named seat that generated it**.

You may not redistribute, republish, resell, or systematically export
configurator output; incorporate it into a product, dataset, or service offered to
others; or use it to reconstruct Faraday's corpus, scoring, or thresholds.
**Section 5 (automated access, scraping, and machine-learning use) applies to
configurator output in full**, including the prohibition on using it to train,
evaluate, benchmark, or ground any model, and including the prohibition on
automated or agent-driven retrieval outside a licensed API.

Running configurations in bulk, by script, or on a schedule in order to enumerate
Faraday's underlying data is prohibited, whether or not it is technically
possible.

## SR-3. Signal provenance and review status

Every signal surfaced in Signal Room carries **provenance** — what source it came
from, when it was collected, and how it was classified — and a **review status**.

- **Reviewed** signals have passed a human editorial review gate.
- **Unreviewed** and **automated** signals are machine-classified output that has
  **not** been through that gate. They are surfaced because timeliness has value,
  and they are labelled so you can weigh them accordingly.
- Classification confidence, where shown, is a model output and is not a guarantee
  of correctness.

**Do not treat an unreviewed signal as a verified fact.** Provenance and review
labels are part of the output; if you reuse output under Section 6 of the Master
Terms, the review status and vintage travel with it.

Signals derive from third-party sources under Section 9 of the Master Terms, and
those licensors' terms pass through. A signal is a pointer to a source, not a
substitute for reading it.

## SR-4. Alerts and delivery

Where Signal Room delivers alerts by email, in-app notification, or webhook,
delivery is **best-effort**. Faraday does not warrant that any alert will be
delivered, delivered on time, or delivered at all, and you must not build a
process that depends on receiving one. Missed, delayed, or duplicate delivery does
not entitle you to compensation.

Alert thresholds, cadences, and quotas may change, and may be limited by plan.

## SR-5. Nothing here is advice

**Section 7 (No advice and no reliance) and Section 8 (Scores, forecasts, and
vintages) of the Master Terms apply in full to configurator output and to every
signal, alert, score, and ranking surfaced in Signal Room.** Signal Room output is
a model estimate as of its vintage, is expected to be revised, and must not be
relied on for capital allocation, siting, or transaction decisions.
