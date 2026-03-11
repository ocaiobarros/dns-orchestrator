// ============================================================
// DNS Control — Local Authentication Context
// Manages session state, login/logout, and route protection.
// In preview mode, uses mock auth. In production, calls backend API.
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const IS_PREVIEW = !import.meta.env.VITE_API_URL;
const API_BASE = import.meta.env.VITE_API_URL || '';
const SESSION_KEY = 'dns-control-session';

// Mock user for preview
const MOCK_USER: AuthUser = {
  id: 'usr-001',
  username: 'admin',
  isActive: true,
  createdAt: '2026-01-15T10:00:00Z',
  lastLoginAt: new Date().toISOString(),
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      if (IS_PREVIEW) {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          setUser(JSON.parse(stored));
        }
        return;
      }

      const token = localStorage.getItem('dns-control-token');
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUser(data.data);
        } else {
          localStorage.removeItem('dns-control-token');
          setUser(null);
        }
      } else {
        localStorage.removeItem('dns-control-token');
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      if (IS_PREVIEW) {
        // Mock: accept admin/admin or any non-empty credentials
        await new Promise(r => setTimeout(r, 400));
        if (!username || !password) {
          return { success: false, error: 'Usuário e senha são obrigatórios' };
        }
        const mockUser = { ...MOCK_USER, username };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(mockUser));
        setUser(mockUser);
        return { success: true };
      }

      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success && data.data?.token) {
        localStorage.setItem('dns-control-token', data.data.token);
        setUser(data.data.user);
        return { success: true };
      }

      return { success: false, error: data.error || 'Credenciais inválidas' };
    } catch {
      return { success: false, error: 'Falha na conexão com o servidor' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (!IS_PREVIEW) {
        const token = localStorage.getItem('dns-control-token');
        if (token) {
          await fetch(`${API_BASE}/api/v1/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        localStorage.removeItem('dns-control-token');
      }
      sessionStorage.removeItem(SESSION_KEY);
      setUser(null);
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
