import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

const MESSAGES: Record<string, string> = {
  not_allowed: 'That Google account is not on the WingPoint allow-list. Ask the owner to add your email.',
  invalid_state: 'Your sign-in session expired. Please try again.',
  token_error: 'Google rejected the sign-in. Please try again.',
  profile_error: 'Could not read your Google profile. Please try again.',
  email_unverified: 'Your Google email is not verified.',
  config_error: 'Google OAuth is not configured on the server.',
  oauth_failed: 'Something went wrong during sign-in.',
};

export function Login() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const error = params.get('auth');
  const [devBusy, setDevBusy] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);

  const devUsersQuery = useQuery({
    queryKey: ['dev-users'],
    queryFn: () => api<{ users: { email: string; name: string }[] }>('/api/auth/dev-users'),
    enabled: import.meta.env.DEV,
    retry: false,
  });

  // The login page itself is never a "return" destination.
  useEffect(() => {
    sessionStorage.removeItem('wp-return-path');
  }, [location.pathname]);

  async function signInDev(email: string) {
    setDevBusy(email);
    setDevError(null);
    try {
      const response = await fetch(`/api/auth/dev?email=${encodeURIComponent(email)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Dev sign-in failed (${response.status})`);
      }
      // Full reload so the new session cookie is picked up everywhere.
      window.location.assign('/');
    } catch (caught) {
      setDevError(caught instanceof Error ? caught.message : 'Dev sign-in failed');
      setDevBusy(null);
    }
  }

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="brand-mark huge">🪽</div>
        <h1>WingPoint</h1>
        <p className="muted">
          Keep score and track stats for Wingspan and its expansions. Sign in to sync your games across
          devices.
        </p>
        {error && <p className="alert alert-error">{MESSAGES[error] ?? 'Sign-in failed.'}</p>}
        <a className="btn btn-primary btn-block" href="/api/auth/google">
          Sign in with Google
        </a>
        {import.meta.env.DEV && (devUsersQuery.data?.users.length ?? 0) > 0 && (
          <div className="dev-logins">
            <p className="fine-print">Dev sign in (local network only)</p>
            {(devUsersQuery.data?.users ?? []).map((account) => (
              <button
                key={account.email}
                type="button"
                className="link"
                onClick={() => void signInDev(account.email)}
                disabled={devBusy !== null}
              >
                {devBusy === account.email
                  ? 'Signing in…'
                  : `${account.name} · ${account.email}`}
              </button>
            ))}
          </div>
        )}
        {devError && <p className="alert alert-error">{devError}</p>}
        <p className="fine-print">Only allow-listed Google accounts can sign in.</p>
      </div>
    </div>
  );
}
