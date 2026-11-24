"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { TOKEN_KEY, chooseToken, parseToken } from "@/lib/predicts-pwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 §1 "Identity"): the recipient credential is the FDY-112/FDY-119
// link token (?t= on the "Manage your preferences" link). An installed app opens at start_url with
// no ?t=, so the token from the last good link visit is kept on this device under
// localStorage["faraday_predicts_token"]. It is never rendered, logged or put in a URL this app
// builds, and only ever sent to predicts-preferences and predicts-push-subscribe. A link the
// function refuses clears it (forget()). Every storage access is wrapped: private mode must not
// break the page.

const EVT = "faraday-predicts-token";

function readStored(): string | null {
  try { return parseToken(window.localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVT, cb); window.removeEventListener("storage", cb); };
}

export function usePredictsToken(): { token: string; forget: () => void } {
  const fromUrl = useSearchParams()?.get("t") ?? null;
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const token = chooseToken(fromUrl, stored) ?? "";

  useEffect(() => {
    const t = parseToken(fromUrl);
    if (!t || t === stored) return;
    try { window.localStorage.setItem(TOKEN_KEY, t); window.dispatchEvent(new Event(EVT)); } catch { /* storage blocked */ }
  }, [fromUrl, stored]);

  const forget = useCallback(() => {
    try { window.localStorage.removeItem(TOKEN_KEY); window.dispatchEvent(new Event(EVT)); } catch { /* storage blocked */ }
  }, []);

  return { token, forget };
}
