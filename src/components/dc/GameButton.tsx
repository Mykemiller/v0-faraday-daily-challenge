"use client";
// ── GameButton (FAR-395) ────────────────────────────────────────────────────
// The one button every game uses — primary actions AND in-puzzle answers/tiles.
// Wraps the pure `resolveButtonStyles` resolver and adds the interaction layer
// inline styles can't express on their own: hover, active/pressed, disabled.
//
// Interaction is pointer-based (not CSS :hover) so it works identically on touch
// — where hover never fires and the pressed state is what gives tactile feedback
// (mobile-first, per the ticket's primary usage mode). Disabled always wins.
import { useState, type ReactNode, type CSSProperties } from "react";
import {
  resolveButtonStyles,
  type ButtonVariant,
  type RevealState,
  type PaletteTokens,
} from "@/lib/dc-ui";
import { useReducedMotion } from "./useReducedMotion";

export interface GameButtonProps {
  children: ReactNode;
  /** The `C` palette object from DailyChallenge.jsx (or any structural subset). */
  tokens: PaletteTokens;
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  reveal?: RevealState;
  small?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
  style?: CSSProperties; // layout overrides (e.g. width:'100%'); never colors
}

export default function GameButton({
  children,
  tokens,
  variant = "primary",
  onClick,
  disabled = false,
  selected = false,
  reveal = null,
  small = false,
  type = "button",
  ariaLabel,
  style,
}: GameButtonProps) {
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const states = resolveButtonStyles({ variant, tokens, selected, reveal, small, reducedMotion });

  const merged: CSSProperties = {
    ...(states.rest as CSSProperties),
    ...(!disabled && hovered ? (states.hover as CSSProperties) : null),
    ...(!disabled && pressed ? (states.active as CSSProperties) : null),
    ...(disabled ? (states.disabled as CSSProperties) : null),
    ...style,
  };

  const clear = () => {
    setHovered(false);
    setPressed(false);
  };

  return (
    <button
      type={type}
      aria-label={ariaLabel}
      aria-pressed={selected || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={clear}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={clear}
      onBlur={clear}
      style={merged}
    >
      {children}
    </button>
  );
}
