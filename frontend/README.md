# frontend

React (Vite) + Tailwind v4. Upload form, job-description textarea, polling status view with
the live stage timeline, and a results dashboard (score dial, matched/missing skills tables,
suggestions).

```bash
npm install
npm run dev      # :5173, proxies /api to localhost:8000
npm run build
```

Set `VITE_API_BASE_URL` to the deployed API URL on Vercel; leave it empty locally so the Vite
dev proxy handles `/api`. Polling backs off from 1.5s to 6s and stops as soon as the match
reaches a terminal state.
