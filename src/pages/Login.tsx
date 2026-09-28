import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

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
  const [params] = useSearchParams();
  const error = params.get('auth');
  const [devBusy, setDevBusy] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  async function signInDev() {
    setDevBusy(true);
    setDevError(null);
    try {
      const response = await fetch('/api/auth/dev', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Dev sign-in failed (${response.status})`);
      }
      window.location.href = '/';
    } catch (caught) {
      setDevError(caught instanceof Error ? caught.message : 'Dev sign-in failed');
      setDevBusy(false);
    }
  }

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
        {import.meta.env.DEV && (
          <>
            <button type="button" className="link" onClick={() => void signInDev()} disabled={devBusy}>
              {devBusy ? 'Signing in…' : 'Dev sign in (localhost only)'}
            </button>
            <p className="fine-print">Requires DEV_LOGIN_EMAIL in .dev.vars.</p>
          </>
        )}
        {devError && <p className="alert alert-error">{devError}</p>}
        <p className="fine-print">Only allow-listed Google accounts can sign in.</p>
      </div>
    </div>
  );
}
