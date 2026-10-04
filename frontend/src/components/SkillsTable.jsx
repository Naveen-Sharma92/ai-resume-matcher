const importanceStyles = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  important: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  nice_to_have: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function MatchedSkillsTable({ skills = [] }) {
  if (!skills.length) return <EmptyRow text="No matched skills found." />;

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4 font-medium">Skill</th>
          <th className="py-2 pr-4 font-medium">Evidence from resume</th>
          <th className="py-2 font-medium text-right">Confidence</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {skills.map((skill) => (
          <tr key={skill.name}>
            <td className="py-3 pr-4 font-medium">{skill.name}</td>
            <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
              {skill.evidence || '—'}
            </td>
            <td className="py-3 text-right tabular-nums text-slate-500">
              {Math.round((skill.confidence ?? 0) * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MissingSkillsTable({ skills = [] }) {
  if (!skills.length) return <EmptyRow text="Nothing important is missing. Nice." />;

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4 font-medium">Skill</th>
          <th className="py-2 pr-4 font-medium">Why it matters</th>
          <th className="py-2 font-medium text-right">Importance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
        {skills.map((skill) => (
          <tr key={skill.name}>
            <td className="py-3 pr-4 font-medium">{skill.name}</td>
            <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">{skill.reason || '—'}</td>
            <td className="py-3 text-right">
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${importanceStyles[skill.importance] ?? importanceStyles.important}`}
              >
                {String(skill.importance ?? 'important').replace(/_/g, ' ')}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyRow({ text }) {
  return <p className="py-6 text-sm text-slate-500">{text}</p>;
}
