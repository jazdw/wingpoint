import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { AuthUser } from '../shared/types';

/** Service worker runtime cache for game data (see vite.config.ts). */
const API_CACHE = 'wp-api';
const USER_KEY = 'wp-user';

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Start from the cached user so an offline reload stays signed in.
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<{ user: AuthUser }>('/api/auth/me')
      .then((result) => {
        if (!active) return;
        setUser(result.user);
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(result.user));
        } catch {
          // ignore storage errors
        }
      })
      .catch((error) => {
        if (!active) return;
        // Only sign out when the server rejects the session. If we are offline
        // the request fails without a status, so keep the cached user.
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          try {
            localStorage.removeItem(USER_KEY);
          } catch {
            // ignore
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      try {
        localStorage.removeItem(USER_KEY);
        // Remove offline drafts so the previous user's game isn't left behind.
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('wp-draft-')) localStorage.removeItem(key);
        }
      } catch {
        // ignore
      }
      // Drop cached API data so it isn't visible to the next user. The app
      // shell precache is kept so the app still opens offline.
      queryClient.clear();
      if ('caches' in window) void caches.delete(API_CACHE);
    }
  }, [queryClient]);

  const value = useMemo(() => ({ user, loading, logout }), [user, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Tracks browser connectivity so the UI can show an offline state. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
