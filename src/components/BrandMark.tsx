// Faraday brand mark — the cream geometric "F" with gold precision terminals
// (Brand Bible Round 6, locked standalone mark). This is the brand identity and
// replaces the retired lightning-bolt logo everywhere in headers/footers. The
// bolt belongs to the product icon system, not the brand mark.

type BrandMarkProps = {
  /** Rendered pixel size of the glyph (square). Default 22. */
  size?: number;
  /** Wrap the glyph in the framed forest tile used in the masthead lockup. */
  framed?: boolean;
  className?: string;
};

export default function BrandMark({ size = 22, framed = false, className }: BrandMarkProps) {
  const glyph = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 110 110"
      role="img"
      aria-label="Faraday"
      style={{ display: "block" }}
    >
      <rect x="30" y="14" width="14" height="82" fill="#F8F5F0" />
      <rect x="30" y="14" width="52" height="13" fill="#F8F5F0" />
      <rect x="30" y="50" width="42" height="12" fill="#F8F5F0" />
      <rect x="78" y="14" width="4" height="13" fill="#C4922A" />
      <rect x="68" y="50" width="4" height="12" fill="#C4922A" />
      <rect x="30" y="92" width="14" height="4" fill="#C4922A" />
    </svg>
  );

  if (!framed) return glyph;

  const tile = Math.round(size * 1.8);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        width: tile,
        height: tile,
        background: "#1C3424",
        border: "1.5px solid rgba(248,245,240,.25)",
        borderRadius: 8,
        display: "grid",
        placeItems: "center",
        flex: "none",
      }}
    >
      {glyph}
    </span>
  );
}
