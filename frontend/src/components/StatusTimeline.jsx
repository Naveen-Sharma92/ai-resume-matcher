const LABELS = {
  queued: 'Queued',
  received: 'Worker picked it up',
  downloading_resume: 'Fetching resume',
  extracting_text: 'Extracting text',
  embedding: 'Embedding resume + job description',
  retrieving_context: 'Retrieving the most relevant sections',
  scoring: 'Scoring with Gemini',
  completed: 'Done',
  failed: 'Failed',
  retry_scheduled: 'Retrying',
};

/** Renders match_events - the same rows the worker writes as it goes. */
export default function StatusTimeline({ timeline = [], isPolling }) {
  return (
    <ol className="space-y-3">
      {timeline.map((event, i) => {
        const isLast = i === timeline.length - 1;
        const active = isLast && isPolling;
        return (
          <li key={`${event.stage}-${event.created_at}-${i}`} className="flex items-start gap-3">
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                event.stage === 'failed'
                  ? 'bg-red-500'
                  : active
                    ? 'animate-pulse bg-indigo-500'
                    : 'bg-emerald-500'
              }`}
            />
            <div>
              <p className="text-sm font-medium">{LABELS[event.stage] ?? event.stage}</p>
              {event.message ? <p className="text-xs text-slate-500">{event.message}</p> : null}
            </div>
            <time className="ml-auto text-xs tabular-nums text-slate-400">
              {new Date(event.created_at).toLocaleTimeString()}
            </time>
          </li>
        );
      })}
      {!timeline.length ? (
        <li className="text-sm text-slate-500">Waiting for the worker…</li>
      ) : null}
    </ol>
  );
}
