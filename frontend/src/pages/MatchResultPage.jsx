import { Link, useParams } from 'react-router-dom';
import { useMatchPolling } from '../hooks/useMatchPolling.js';
import ScoreRing from '../components/ScoreRing.jsx';
import StatusTimeline from '../components/StatusTimeline.jsx';
import SuggestionsList from '../components/SuggestionsList.jsx';
import { MatchedSkillsTable, MissingSkillsTable } from '../components/SkillsTable.jsx';

export default function MatchResultPage() {
  const { id } = useParams();
  const { status, result, error, isPolling } = useMatchPolling(id);

  if (error) {
    return <ErrorBox message={error.message} />;
  }

  if (!result) {
    return (
      <section className="mx-auto max-w-lg">
        <h1 className="text-xl font-semibold">
          {status?.status === 'failed' ? 'Analysis failed' : 'Analysing…'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {status?.status === 'failed'
            ? status.error
            : 'This usually takes 10-30 seconds on the free tier.'}
        </p>
        <div className="mt-6 rounded-lg border border-slate-200 p-5 dark:border-slate-800">
          <StatusTimeline timeline={status?.timeline ?? []} isPolling={isPolling} />
        </div>
        {status?.status === 'failed' ? (
          <Link to="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            Try another resume
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-6 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-semibold">
            {result.job.title || 'Match result'}
            {result.job.company ? (
              <span className="text-slate-500"> · {result.job.company}</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{result.resume.filename}</p>
          <p className="mt-3 max-w-xl text-sm">{result.summary}</p>
          <p className="mt-3 text-xs text-slate-400">
            {result.model} · {result.latencyMs} ms
          </p>
        </div>
        <ScoreRing score={result.score} />
      </header>

      <Section title={`Matched skills (${result.matchedSkills.length})`}>
        <MatchedSkillsTable skills={result.matchedSkills} />
      </Section>

      <Section title={`Missing or unproven (${result.missingSkills.length})`}>
        <MissingSkillsTable skills={result.missingSkills} />
      </Section>

      <Section title="Suggested improvements">
        <SuggestionsList suggestions={result.suggestions} />
      </Section>

      <Link to="/" className="inline-block text-sm text-indigo-600 hover:underline">
        Run another match
      </Link>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {message}
    </div>
  );
}
