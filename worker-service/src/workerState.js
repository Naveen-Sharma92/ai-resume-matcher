/** Tiny in-process state shared between the consumer and the health endpoints. */
const state = {
  startedAt: new Date().toISOString(),
  consumerRunning: false,
  processed: 0,
  failed: 0,
  lastMatchId: null,
  lastProcessedAt: null,
};

export const getWorkerState = () => ({ ...state, uptimeSeconds: Math.round(process.uptime()) });

export const setConsumerRunning = (running) => {
  state.consumerRunning = running;
};

export const recordProcessed = (matchId) => {
  state.processed += 1;
  state.lastMatchId = matchId;
  state.lastProcessedAt = new Date().toISOString();
};

export const recordFailed = () => {
  state.failed += 1;
};
