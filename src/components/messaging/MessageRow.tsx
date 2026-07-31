"use client";

// One message bubble (CC-DC-MESSAGING-1.0; extracted from MessagesApp.tsx in
// CC-DC-MSG-DOCK-1.0 so the /messages inbox and the masthead message dock
// render the identical row). Bodies are plain text rendered with
// pre-wrap + overflowWrap:anywhere — never HTML.

import { useState } from "react";
import { type ThreadDetail, msgTime } from "./client";

export default function MessageRow({
  m,
  unread,
  onDelete,
  onReport,
}: {
  m: ThreadDetail["messages"][number];
  unread: boolean;
  onDelete: (id: string) => void;
  onReport: (id: string) => Promise<boolean>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <div className={m.is_mine ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[85%] min-[900px]:max-w-[70%] ${unread ? "border-l-2 border-gold pl-2" : ""}`}>
        <p className="mb-0.5 font-mono text-[10px] text-near-black/45">
          @{m.author_handle} · {msgTime(m.created_at)}
          {unread && (
            <span className="ml-1.5 rounded bg-gold/20 px-1 py-px font-mono text-[8px] font-bold uppercase tracking-widest text-forest">
              new
            </span>
          )}
        </p>
        <div
          className={`rounded-lg px-3 py-2 text-sm text-near-black ${
            m.is_mine ? "bg-gold/10 ring-1 ring-gold/25" : "bg-warm-cream/70"
          }`}
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {m.body}
        </div>
        <div className="mt-0.5 flex gap-2">
          {m.can_delete &&
            (!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded font-mono text-[10px] text-near-black/35 hover:text-brick focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { onDelete(m.id); setConfirmDelete(false); }}
                  className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  Confirm delete?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded font-mono text-[10px] text-near-black/45 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  Cancel
                </button>
              </span>
            ))}
          {!m.is_mine &&
            (reported ? (
              <span className="font-mono text-[10px] text-forest" role="status">Reported ✓</span>
            ) : (
              <button
                type="button"
                onClick={async () => { if (await onReport(m.id)) setReported(true); }}
                className="rounded font-mono text-[10px] text-near-black/35 hover:text-brick focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                Report
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
