import { notFound } from "next/navigation";
import DcStubPage from "@/components/DcStubPage";

// Help & Feedback stubs — one route per item in the header "?" dropdown
// (buildHeaderMenus / buildSiteMenus). All six are placeholders; replace a
// TOPICS entry with a real page (or repoint the menu) when one exists.

const TOPICS: Record<string, { title: string; blurb: string; note?: string }> = {
  hints: {
    title: "Hints",
    blurb: "How hints work across the seven daily games, and how to use them without giving the answer away.",
    note: "Hints are already live inside every puzzle — look for the “Hint?” button while you play (up to 3 per game per day). This page will collect per-game hint guides.",
  },
  tips: {
    title: "Tips and Tricks",
    blurb: "Strategy notes for each game format — how regulars keep streaks alive and squeeze out the bonus points.",
  },
  questions: {
    title: "Questions",
    blurb: "Frequently asked questions about scoring, streaks, teams, and the daily rotation.",
  },
  glossary: {
    title: "Glossary",
    blurb: "The data-center-economy terms the puzzles draw from, defined.",
    note: "Definitions come from the Faraday Lexicon, which already powers the games behind the scenes. A browsable glossary is on the way.",
  },
  "report-a-bug": {
    title: "Report a Bug",
    blurb: "Found something broken — a puzzle that won't score, a tile that won't drag? A proper report form is coming here.",
  },
  feedback: {
    title: "Feedback",
    blurb: "Tell us what you'd change about the Daily Challenge — game ideas, difficulty, anything.",
  },
};

export function generateStaticParams() {
  return Object.keys(TOPICS).map((topic) => ({ topic }));
}

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const t = TOPICS[topic];
  return { title: t ? `${t.title} · Faraday Daily Challenge` : "Help" };
}

export default async function HelpTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const t = TOPICS[topic];
  if (!t) notFound();
  return (
    <DcStubPage title={t.title} blurb={t.blurb}>
      {t.note && <p>{t.note}</p>}
    </DcStubPage>
  );
}
