import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

const TERMINAL = ['completed', 'failed'];

/**
 * Polls /matches/:id/status until the job reaches a terminal state, then
 * fetches the result once.
 *
 * Backs off from 1.5s to 6s: the first few seconds are when the answer usually
 * lands, and after that there is no point hammering a free-tier API.
 */
export function useMatchPolling(matchId) {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!matchId) return undefined;

    let cancelled = false;
    let delay = 1500;

    const tick = async () => {
      try {
        const next = await api.matchStatus(matchId);
        if (cancelled) return;
        setStatus(next);

        if (TERMINAL.includes(next.status)) {
          if (next.status === 'completed') {
            const data = await api.matchResult(matchId);
            if (!cancelled) setResult(data);
          }
          return;
        }

        delay = Math.min(Math.round(delay * 1.25), 6000);
        timer.current = setTimeout(tick, delay);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [matchId]);

  return { status, result, error, isPolling: status ? !TERMINAL.includes(status.status) : true };
}

export default useMatchPolling;
