import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

const LAST_PATH_KEY = 'wp-last-path';
const RETURN_PATH_KEY = 'wp-return-path';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

/**
 * Keeps the URL and the visible page in sync across reloads and PWA launches.
 *
 * - Remembers the current path so an installed PWA (which always launches at
 *   the manifest `start_url`, "/") can return to the page you were last on.
 * - Remembers a deep link you were heading to while signed out, and returns to
 *   it once you sign in.
 */
export function RouteMemory() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Captured at mount, before this component starts overwriting it.
  const previousPath = useRef<string | null>(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_PATH_KEY),
  );
  const restored = useRef(false);

  useEffect(() => {
    const current = location.pathname + location.search;

    // If we're signed out on a deep link, remember where to come back to.
    if (!user && location.pathname !== '/') {
      sessionStorage.setItem(RETURN_PATH_KEY, current);
    }

    localStorage.setItem(LAST_PATH_KEY, current);

    if (restored.current) return;

    // After signing in, return to the deep link we remembered.
    if (user && location.pathname === '/') {
      const returnPath = sessionStorage.getItem(RETURN_PATH_KEY);
      if (returnPath && returnPath !== '/') {
        sessionStorage.removeItem(RETURN_PATH_KEY);
        restored.current = true;
        navigate(returnPath, { replace: true });
        return;
      }
    }

    // Installed PWAs launch at "/", so restore the last page.
    if (
      isStandalone() &&
      location.pathname === '/' &&
      previousPath.current &&
      previousPath.current !== '/'
    ) {
      restored.current = true;
      navigate(previousPath.current, { replace: true });
    }
  }, [location, navigate, user]);

  return null;
}
