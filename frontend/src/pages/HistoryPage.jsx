import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const statusStyles = {
  completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  processing: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  queued: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export default function HistoryPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listMatches()
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!items.length)
    return (
      <p className="text-sm text-slate-500">
        No matches yet.{' '}
        <Link to="/" className="text-indigo-600 hover:underline">
          Run one
        </Link>
        .
      </p>
    );

  return (
    <div>
      <h1 className="text-xl font-semibold">Previous matches</h1>
      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Role</th>
            <th className="py-2 pr-4 font-medium">Resume</th>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
              <td className="py-3 pr-4">
                <Link
                  to={`/matches/${m.id}`}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  {m.job_title || 'Untitled role'}
                </Link>
                {m.job_company ? <span className="text-slate-500"> · {m.job_company}</span> : null}
              </td>
              <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">{m.resume_filename}</td>
              <td className="py-3 pr-4 text-slate-500">
                {new Date(m.created_at).toLocaleString()}
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyles[m.status] ?? statusStyles.queued}`}
                >
                  {m.status}
                </span>
              </td>
              <td className="py-3 text-right tabular-nums font-medium">
                {m.score === null ? '—' : Number(m.score).toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
