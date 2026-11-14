"use client";

import { useEffect, useState } from "react";
import { PREDICTS_SCOPE, PREDICTS_SW_PATH, PWA_COPY, formatCachedAt } from "@/lib/predicts-pwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 §2–§3, 2a) — the installable shell's client half, rendered once by
// src/app/predicts/layout.tsx:
//   · registers /predicts/sw.js with scope /predicts (production builds only, so `next dev` never
//     serves stale pages from a worker);
//   · shows the offline banner (spec §8) with the time the page on screen was cached;
//   · offers "Install Faraday Predicts" where the browser fires beforeinstallprompt (Android/desktop
//     Chromium). iOS has no such event; its hint lives with the push toggle.
// Kill switch: NEXT_PUBLIC_PREDICTS_PWA=off unregisters the worker and renders nothing.
// No permission prompt ever happens here — only the preferences toggle asks (§6).

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISABLED = process.env.NEXT_PUBLIC_PREDICTS_PWA === "off";

async function askCachedAt(): Promise<number | null> {
  const ctl = navigator.serviceWorker?.controller;
  if (!ctl) return null;
  return await new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(typeof e.data?.at === "number" ? e.data.at : null); };
    ctl.postMessage({ type: "cached-at", url: window.location.pathname + window.location.search }, [ch.port2]);
  });
}

export default function PredictsPwa() {
  const [offlineAt, setOfflineAt] = useState<string | null | undefined>(undefined); // undefined = online
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (DISABLED) {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.filter((r) => new URL(r.scope).pathname.startsWith(PREDICTS_SCOPE)).forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register(PREDICTS_SW_PATH, { scope: PREDICTS_SCOPE }).catch(() => {});
  }, []);

  useEffect(() => {
    if (DISABLED) return;
    const update = async () => {
      if (navigator.onLine) { setOfflineAt(undefined); return; }
      setOfflineAt(formatCachedAt(await askCachedAt()) ?? null);
    };
    void update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (DISABLED) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const onInstalled = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (DISABLED) return null;
  return (
    <>
      {offlineAt !== undefined && (
        <div role="status" className="border-b border-cream-border bg-warm-cream">
          <p className="mx-auto max-w-6xl px-4 py-2 font-sans text-[14px] text-near-black">
            {PWA_COPY.offlineBanner(offlineAt ?? PWA_COPY.offlineUnknownDate)}
          </p>
        </div>
      )}
      {install && offlineAt === undefined && (
        <div className="mx-auto flex max-w-6xl justify-end px-4 pt-3">
          <button
            type="button"
            onClick={async () => {
              const ev = install;
              setInstall(null);
              await ev.prompt().catch(() => {});
            }}
            className="min-h-[44px] rounded-full border border-forest px-5 font-sans text-[14px] font-medium text-forest hover:bg-forest hover:text-warm-white"
          >
            {PWA_COPY.installPrompt}
          </button>
        </div>
      )}
    </>
  );
}
