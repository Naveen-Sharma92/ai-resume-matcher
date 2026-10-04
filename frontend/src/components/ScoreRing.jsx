/** Conic-gradient score dial. Colour tracks the band, not just the number. */
export default function ScoreRing({ score = 0, size = 168 }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const band = value >= 75 ? 'strong' : value >= 50 ? 'partial' : 'weak';
  const colors = {
    strong: '#059669',
    partial: '#d97706',
    weak: '#dc2626',
  };
  const label = { strong: 'Strong fit', partial: 'Partial fit', weak: 'Weak fit' }[band];

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="grid place-items-center rounded-full"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${colors[band]} ${value * 3.6}deg, rgba(148,163,184,0.25) 0deg)`,
        }}
        role="img"
        aria-label={`Match score ${value} out of 100`}
      >
        <div className="grid h-[78%] w-[78%] place-items-center rounded-full bg-white dark:bg-slate-900">
          <div className="text-center">
            <div className="text-4xl font-semibold tabular-nums">{value.toFixed(0)}</div>
            <div className="text-xs uppercase tracking-wide text-slate-500">out of 100</div>
          </div>
        </div>
      </div>
      <span className="text-sm font-medium" style={{ color: colors[band] }}>
        {label}
      </span>
    </div>
  );
}
