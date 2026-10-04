import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

const MAX_MB = 5;

export default function NewMatchPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFileChange = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return setFile(null);
    if (picked.size > MAX_MB * 1024 * 1024) {
      setError(
        `That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB - the limit is ${MAX_MB} MB.`
      );
      return setFile(null);
    }
    setError(null);
    return setFile(picked);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!file) return setError('Pick a PDF or DOCX resume first.');
    setBusy(true);
    setError(null);
    try {
      const data = await api.createMatch({ file, jobDescription, title, company });
      navigate(`/matches/${data.matchId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const jdTooShort = jobDescription.trim().length > 0 && jobDescription.trim().length < 50;

  return (
    <div>
      <h1 className="text-xl font-semibold">Score a resume against a job description</h1>
      <p className="mt-1 text-sm text-slate-500">
        The upload returns immediately; parsing, embedding and scoring happen on the worker.
      </p>

      <form onSubmit={onSubmit} className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Resume (PDF or DOCX, max {MAX_MB} MB)</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onFileChange}
              className="mt-1 w-full rounded-md border border-dashed border-slate-300 px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700 dark:border-slate-700"
            />
            {file ? (
              <span className="mt-1 block text-xs text-slate-500">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            ) : null}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Role title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Backend SDE-1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Company</span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
          </div>
        </div>

        <div>
          <label className="block">
            <span className="text-sm font-medium">Job description</span>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              rows={14}
              required
              placeholder="Paste the full job description here…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span className={jdTooShort ? 'text-amber-600' : ''}>
              {jdTooShort ? 'At least 50 characters' : 'Paste requirements and responsibilities'}
            </span>
            <span className="tabular-nums">{jobDescription.length} chars</span>
          </div>
        </div>

        <div className="md:col-span-2">
          {error ? (
            <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !file || jobDescription.trim().length < 50}
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Queueing…' : 'Analyse match'}
          </button>
        </div>
      </form>
    </div>
  );
}
