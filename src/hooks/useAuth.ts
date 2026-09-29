import { createContext, useContext } from 'react';
import type { AuthUser } from '../../shared/types';

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

/** Provided by `AuthProvider` (src/auth.tsx). */
export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
