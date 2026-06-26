// Search box that filters the visible tree(s). Controlled by MainView and
// rendered as a footer inside the tree panel (WoW-style, at the bottom of the
// talent frame); the actual highlighting happens in TalentNode/HeatmapNode via
// SearchContext.
export default function TalentSearch({ value, onChange, matchCount }) {
  const active = value.trim().length > 0;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded"
      style={{
        background: "rgba(0,0,0,0.25)",
        border: "1px solid #5a4a1e",
      }}
    >
      <span
        className="text-wow-gold text-sm select-none opacity-80"
        aria-hidden
      >
        ⌕
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search talents…"
        aria-label="Search talents"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent text-sm text-wow-text placeholder-wow-dim outline-none"
      />
      {active && (
        <>
          <span className="text-wow-muted text-xs tabular-nums select-none">
            {matchCount} {matchCount === 1 ? "match" : "matches"}
          </span>
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="shrink-0 text-wow-muted hover:text-wow-gold transition-colors text-base leading-none"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
