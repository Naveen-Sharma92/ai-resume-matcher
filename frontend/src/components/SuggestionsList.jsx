const priorityStyles = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-500',
  low: 'border-l-slate-300',
};

export default function SuggestionsList({ suggestions = [] }) {
  if (!suggestions.length)
    return <p className="text-sm text-slate-500">No suggestions returned.</p>;

  return (
    <ol className="space-y-3">
      {suggestions.map((s, i) => (
        <li
          key={`${s.title}-${i}`}
          className={`rounded-r-lg border-l-4 bg-slate-50 p-4 dark:bg-slate-900 ${priorityStyles[s.priority] ?? priorityStyles.medium}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-medium">{s.title}</h4>
            <span className="text-xs uppercase tracking-wide text-slate-500">{s.priority}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}
