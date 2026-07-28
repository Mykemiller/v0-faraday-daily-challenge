// ── Daily Challenge shared React primitives (FAR-395) ───────────────────────
// Thin React wrappers over the pure logic in @/lib/dc-ui. See
// docs/far395-ui-primitives/. Not yet wired into the 7 games — that is the
// per-game migration work (PRs 2..N).
export { default as GameButton } from "./GameButton";
export { default as GameFrame } from "./GameFrame";
export { default as BrandAnchor } from "./BrandAnchor";
export { default as PuzzleGrid } from "./PuzzleGrid";
export { useReducedMotion } from "./useReducedMotion";
