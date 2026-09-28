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
        <p className="fine-print">Only allow-listed Google accounts can sign in.</p>
      </div>
    </div>
  );
}
