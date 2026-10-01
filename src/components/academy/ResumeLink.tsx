"use client";
// Faraday Academy — "pick up where you left off".
//
// Reads localStorage, so it renders nothing on the server and nothing for a reader
// who has not started. No sign-in is involved or suggested.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getResume } from "@/lib/academy/progress";
import { lessonHref } from "@/lib/academy/nav";

export default function ResumeLink({ slug }: { slug: string }) {
  const [at, setAt] = useState<{ module: number; lesson: number } | null>(null);

  useEffect(() => {
    setAt(getResume(slug));
  }, [slug]);

  if (!at) return null;

  return (
    <Link
      href={lessonHref(slug, at.module, at.lesson)}
      className="inline-block px-4 py-2 text-sm font-medium"
      style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
    >
      Resume module {at.module}, lesson {at.lesson}
    </Link>
  );
}
