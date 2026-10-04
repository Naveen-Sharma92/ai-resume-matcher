import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    tenantSlug: 'demo',
    tenantName: 'Demo Workspace',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login({ email: form.email, password: form.password, tenantSlug: form.tenantSlug });
      } else {
        await register(form);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">
        {mode === 'login' ? 'Sign in' : 'Create your workspace'}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Every account belongs to a workspace (tenant). All resumes, job descriptions and results are
        scoped to it.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === 'register' ? (
          <Field label="Full name" value={form.fullName} onChange={update('fullName')} required />
        ) : null}
        <Field label="Email" type="email" value={form.email} onChange={update('email')} required />
        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={update('password')}
          required
          hint={mode === 'register' ? 'At least 8 characters' : undefined}
        />
        <Field
          label="Workspace slug"
          value={form.tenantSlug}
          onChange={update('tenantSlug')}
          required
          hint={
            mode === 'register'
              ? 'New slug creates a workspace and makes you its owner; an existing slug joins it.'
              : undefined
          }
        />

        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="mt-4 text-sm text-indigo-600 hover:underline"
      >
        {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
      </button>
    </div>
  );
}

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900"
      />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
