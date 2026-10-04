import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (!tokenStore.access) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.currentUser();
        if (!cancelled) setUser(data.user);
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async login(payload) {
        const data = await api.login(payload);
        tokenStore.set(data);
        setUser(data.user);
        return data.user;
      },
      async register(payload) {
        const data = await api.register(payload);
        tokenStore.set(data);
        setUser(data.user);
        return data.user;
      },
      async logout() {
        await api.logout().catch(() => {});
        tokenStore.clear();
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
