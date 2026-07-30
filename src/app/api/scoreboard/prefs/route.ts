// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — /api/scoreboard/prefs
// Alias of /api/v1/subscriber/prefs — identical SubscriberPrefs contract, one implementation.
// (Supersedes the earlier {pick5,region} shape; the FE contract's SubscriberPrefs is canonical.)
export { GET, PATCH, POST } from "../../v1/subscriber/prefs/route";
