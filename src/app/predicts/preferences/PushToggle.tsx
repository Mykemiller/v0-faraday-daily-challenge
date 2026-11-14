"use client";

import { useEffect, useState } from "react";
import { COPY } from "@/lib/predicts-preferences";
import { PWA_COPY, isIOSUserAgent, platformOf, pushSupportState, vapidKeyBytes, type PushSupport } from "@/lib/predicts-pwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 §6 D4, §9) — "Flash alerts on this device".
//
// A separate, explicit toggle, OFF by default, never inferred from email/SMS consent. Turning it on
// runs, in order: the tap → Notification.requestPermission() → pushManager.subscribe() →
// POST predicts-push-subscribe {consent:true} (which stamps consent_at). If any step fails, the
// toggle stays off and any half-made browser subscription is removed. Turning it off revokes this
// device's endpoint server-side and unsubscribes locally. No prompt ever happens on page load.
//
// Ships DARK: with no NEXT_PUBLIC_PREDICTS_VAPID_PUBLIC_KEY (Myke creates it) this renders nothing.
// iOS Safari outside an installed Home Screen app gets the install hint instead of a toggle that
// would silently fail (§9).

type Props = { token: string; subscribeUrl: string; vapidKey: string | null };

const FETCH_INIT: RequestInit = { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit" };
const READY_TIMEOUT_MS = 8000;

function env(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupportState({
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIOS: isIOSUserAgent(navigator.userAgent, navigator.maxTouchPoints),
    isStandalone: window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true,
    permission: "Notification" in window ? Notification.permission : null,
  });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no service worker")), READY_TIMEOUT_MS)),
  ]);
}

export default function PushToggle({ token, subscribeUrl, vapidKey }: Props) {
  const key = vapidKeyBytes(vapidKey);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!key) return;
    const s = env();
    setSupport(s);
    if (s === "granted" || s === "prompt") {
      registration().then((r) => r.pushManager.getSubscription()).then((sub) => setOn(!!sub && s === "granted")).catch(() => {});
    }
    // key is derived from a prop string; re-run only when that string changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vapidKey]);

  if (!key || support === null) return null;

  const post = (body: Record<string, unknown>) =>
    fetch(subscribeUrl, { ...FETCH_INIT, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setSupport(env()); if (permission === "denied") setError(PWA_COPY.permissionDenied); return; }
    const reg = await registration();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
    const r = await post({ action: "subscribe", consent: true, platform, subscription: sub.toJSON() }).catch(() => null);
    if (!r || !r.ok) { await sub.unsubscribe().catch(() => {}); setError(COPY.unavailable); return; }
    reg.active?.postMessage({ type: "push-config", config: { subscribeUrl, token, vapidKey, platform } });
    setSupport("granted");
    setOn(true);
  }

  async function disable() {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const r = await post({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => null);
      if (!r || !r.ok) { setError(COPY.unavailable); return; }
      await sub.unsubscribe().catch(() => {});
    }
    reg.active?.postMessage({ type: "push-config-clear" });
    setOn(false);
  }

  async function toggle() {
    setError("");
    if (!navigator.onLine) { setError(PWA_COPY.offlineWriteRefused); return; }
    setBusy(true);
    try { await (on ? disable() : enable()); } catch { setError(COPY.unavailable); } finally { setBusy(false); }
  }

  if (support === "ios_needs_install") return <p className="font-sans text-[14px] text-near-black/80">{PWA_COPY.iosInstallHint}</p>;
  if (support === "unsupported") return <p className="font-sans text-[14px] text-near-black/80">{PWA_COPY.unsupported}</p>;

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={busy || support === "denied"}
        onClick={() => void toggle()}
        className="flex min-h-[44px] items-center gap-3 font-sans text-[15px] text-near-black disabled:cursor-not-allowed"
      >
        <span aria-hidden className={`relative inline-block h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? "border-forest bg-forest" : "border-near-black/50 bg-cream-edge"}`}>
          <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-warm-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
        </span>
        <span>{PWA_COPY.toggle}</span>
      </button>
      <p className="mt-1 max-w-xl font-sans text-[14px] text-near-black/75">{PWA_COPY.toggleHelp}</p>
      {support === "denied" && <p className="mt-1 font-sans text-[14px] text-brick">{PWA_COPY.permissionDenied}</p>}
      {error && support !== "denied" && <p role="alert" className="mt-1 font-sans text-[14px] text-brick">{error}</p>}
    </div>
  );
}
