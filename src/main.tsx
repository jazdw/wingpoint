import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider } from './auth.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { RouteMemory } from './components/RouteMemory.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

async function clearServiceWorkerCaches(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

// Escape hatch: open any page with ?reset=1 to drop the service worker and all
// caches, then reload clean. Handy if a stale cache ever serves an old build.
if (new URLSearchParams(window.location.search).has('reset')) {
  void clearServiceWorkerCaches().finally(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.location.replace(url.toString());
  });
} else if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              // A new version is ready — reload so it takes effect immediately.
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                window.location.reload();
              }
            });
          });
        })
        .catch((error) => {
          console.warn('Service worker registration failed', error);
        });
    });
  } else {
    // In dev, clear any stale worker/caches from an earlier preview build.
    void clearServiceWorkerCaches();
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <RouteMemory />
            <App />
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
