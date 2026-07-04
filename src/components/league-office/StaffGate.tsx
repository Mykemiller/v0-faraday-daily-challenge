"use client";

// League Office — client staff gate. Mirrors the existing dc_session token into
// the httpOnly lo_session cookie via /api/league-office/session, then reveals the
// console only for a verified staff email. Every server reader re-verifies that
// cookie independently, so this gate is the UX fence, not the security fence.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SESSION_STORAGE_KEY } from "@/lib/supabase";

type Phase = "checking" | "ok" | "anon" | "denied" | "unconfigured";

export default function StaffGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const refreshed = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      /* storage disabled */
    }
    if (!token) {
      setPhase("anon");
      return;
    }
    fetch("/api/league-office/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (r.ok) {
          setPhase("ok");
          if (!refreshed.current) {
            refreshed.current = true;
            router.refresh(); // re-run Server Components now the cookie exists
          }
          return;
        }
        if (r.status === 403) return setPhase("denied");
        if (r.status === 500) return setPhase("unconfigured");
        setPhase("anon");
      })
      .catch(() => setPhase("unconfigured"));
  }, [router]);

  if (phase === "ok") return <>{children}</>;

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: 24 }}>
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          background: "#fff",
          border: "1px solid var(--color-cream-border)",
          borderRadius: 12,
          padding: "28px 26px",
          textAlign: "center",
        }}
      >
        {phase === "checking" && (
          <>
            <Dot />
            <p style={{ fontSize: 14, color: "#6b6257", margin: "14px 0 0" }}>
              Verifying commissioner access…
            </p>
          </>
        )}
        {phase === "anon" && (
          <>
            <h2 className="font-serif" style={{ fontSize: 20, margin: 0 }}>
              Staff sign-in required
            </h2>
            <div className="double-rule" style={{ margin: "12px auto 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 18px" }}>
              League Office is internal. Sign in with your staff email to continue.
            </p>
            <Link
              href="/auth"
              style={{
                display: "inline-block",
                background: "var(--color-forest)",
                color: "#f8f5f0",
                borderRadius: 8,
                padding: "10px 20px",
                fontWeight: 600,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Go to sign-in
            </Link>
          </>
        )}
        {phase === "denied" && (
          <>
            <h2 className="font-serif" style={{ fontSize: 20, margin: 0 }}>
              Not authorized
            </h2>
            <div className="double-rule" style={{ margin: "12px auto 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 0" }}>
              This account isn&rsquo;t on the commissioner allowlist. If that&rsquo;s a
              mistake, contact the League Office administrator.
            </p>
          </>
        )}
        {phase === "unconfigured" && (
          <>
            <h2 className="font-serif" style={{ fontSize: 20, margin: 0 }}>
              Console not configured
            </h2>
            <div className="double-rule" style={{ margin: "12px auto 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 0" }}>
              The League Office data service is unavailable. Set{" "}
              <code style={{ fontSize: 12 }}>SUPABASE_SERVICE_ROLE_KEY</code> in the
              deployment environment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: "var(--color-gold)",
        boxShadow: "0 0 0 0 rgba(196,146,42,.5)",
        animation: "loPulse 1.4s ease-out infinite",
      }}
    />
  );
}
