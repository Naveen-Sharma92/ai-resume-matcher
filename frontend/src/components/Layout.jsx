import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const navLinkClass = ({ isActive }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
  }`;

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Resume<span className="text-indigo-600">Matcher</span>
          </Link>
          {user ? (
            <nav className="flex items-center gap-1">
              <NavLink to="/" className={navLinkClass} end>
                New match
              </NavLink>
              <NavLink to="/history" className={navLinkClass}>
                History
              </NavLink>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span className="hidden text-slate-500 sm:inline">{user.email}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-slate-400">
        Express · Kafka · pgvector RAG · Gemini — all on free tiers.
      </footer>
    </div>
  );
}
