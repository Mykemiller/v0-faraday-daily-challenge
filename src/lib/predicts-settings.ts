// FDY-297 (ADM-2.4) — the Predicts PWA kill switch as data. SERVER-ONLY (reads the Faraday service-role key).
//
// NEXT_PUBLIC_PREDICTS_PWA=off was a build-time kill switch for the installable shell (FDY-127). It is now read
// on the server from the Faraday config store (app FP, key predicts_pwa_enabled) and handed to the client
// component as a prop. A value set in the Workbench console wins within 60 s, with no redeploy. If the read
// fails, the key is unknown, the value is not a boolean, or nobody has set a value, the env value stays.
//
// Pure apart from the injected resolver: no next/* imports, so `node --test` can load it directly.
import { createResolver, resolveSettings, type Resolver } from "./config/resolver.ts";

export const PREDICTS_APP_CODE = "FP";

/** The env value: the fail-closed fallback. The shell is on unless NEXT_PUBLIC_PREDICTS_PWA is exactly "off". */
export const predictsPwaEnabledFromEnv = (): boolean => process.env.NEXT_PUBLIC_PREDICTS_PWA !== "off";

export const PREDICTS_SETTING_SPECS = {
  pwaEnabled: { key: "predicts_pwa_enabled", type: "boolean" as const, env: predictsPwaEnabledFromEnv },
};

const resolver = createResolver();

export async function predictsPwaEnabled(r: Pick<Resolver, "resolve"> = resolver): Promise<boolean> {
  const got = await resolveSettings(r, PREDICTS_APP_CODE, PREDICTS_SETTING_SPECS);
  return got.values.pwaEnabled;
}
