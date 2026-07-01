// Orchestrates the three JW inference methods in dependency order:
//   1. Method A — Geographic Inheritance (seeds all unscored counties)
//   2. Utility Queue — applies real power data on top of Method A
//   3. Method B — Demographic Correlate Model (refines inherited scores)
//   4. Method C — event-triggered DB trigger (always active via migration 20260627000005)

import {
  runGeographicInheritance,
  applyUtilityQueueScores,
  runDemographicCorrelateModel,
} from './inference-engine';

export interface InferenceResult {
  inherited:    number;
  powerScored:  number;
  refined:      number;
  elapsedMs:    number;
}

export async function runFullInferenceEngine(): Promise<InferenceResult> {
  console.log('=== JW Inference Engine starting ===');
  const start = Date.now();

  // Method A must run first — creates the county rows that the other steps update
  const inherited   = await runGeographicInheritance();

  // Power data applies on top of Method A county rows
  const powerScored = await applyUtilityQueueScores();

  // Method B refines scores already produced by Method A + power update
  const refined     = await runDemographicCorrelateModel();

  const elapsedMs = Date.now() - start;
  console.log(`=== Inference Engine complete in ${(elapsedMs / 1000).toFixed(1)}s ===`);
  console.log(`  Method A (inheritance):   ${inherited} counties seeded`);
  console.log(`  Utility queue scores:     ${powerScored} counties updated`);
  console.log(`  Method B (demographic):   ${refined} counties refined`);
  console.log('  Method C (event trigger): active — fires on new artifact ingestion');

  return { inherited, powerScored, refined, elapsedMs };
}
