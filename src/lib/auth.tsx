// ============================================================
// DNS Control — Authentication Context
// Manages session state, login/logout, session timeout,
// and forced password change flow.
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SessionInfo {
  expiresAt: string;
  sessionTimeoutMinutes: number;
  sessionWarningSeconds: number;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  sessionInfo: SessionInfo | null;
  showSessionWarning: boolean;
  sessionSecondsLeft: number;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; mustChangePassword?: boolean }>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  dismissSessionWarning: () => void;
  forceChangePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const IS_PREVIEW = !import.meta.env.VITE_API_URL;
const API_BASE = import.meta.env.VITE_API_URL || '';
const SESSION_KEY = 'dns-control-session';
const TOKEN_KEY = 'dns-control-token';

const MOCK_USER: AuthUser = {
  id: 'usr-001',
  username: 'admin',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-15T10:00:00Z',
  lastLoginAt: new Date().toISOString(),
};

const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
const DEFAULT_SESSION_WARNING_SECONDS = 120;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [showSessionWarning, setShowSessionWarning] = useState(false);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(0);
  const warningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTriggeredRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearInterval(warningTimerRef.current);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    warningTimerRef.current = null;
    expiryTimerRef.current = null;
    warningTriggeredRef.current = false;
  }, []);

  const startSessionTimers = useCallback((expiresAt: string, warningSeconds: number) => {
    clearTimers();
    const expiresMs = new Date(expiresAt).getTime();

    const checkExpiry = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresMs - now) / 1000));

      if (remaining <= 0) {
        // Session expired
        clearTimers();
        setShowSessionWarning(false);
        setUser(null);
        setSessionInfo(null);
        if (IS_PREVIEW) sessionStorage.removeItem(SESSION_KEY);
        else localStorage.removeItem(TOKEN_KEY);
        return;
      }

      if (remaining <= warningSeconds && !warningTriggeredRef.current) {
        warningTriggeredRef.current = true;
        setShowSessionWarning(true);
      }

      if (warningTriggeredRef.current) {
        setSessionSecondsLeft(remaining);
      }
    };

    warningTimerRef.current = setInterval(checkExpiry, 1000);
    checkExpiry();
  }, [clearTimers]);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      if (IS_PREVIEW) {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed.user || parsed);
          const si = parsed.sessionInfo || {
            expiresAt: new Date(Date.now() + DEFAULT_SESSION_TIMEOUT_MINUTES * 60000).toISOString(),
            sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
            sessionWarningSeconds: DEFAULT_SESSION_WARNING_SECONDS,
          };
          setSessionInfo(si);
          startSessionTimers(si.expiresAt, si.sessionWarningSeconds);
        }
        return;
      }

      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setUser({
          id: data.user.id,
          username: data.user.username,
          isActive: data.user.is_active,
          mustChangePassword: data.user.must_change_password,
          createdAt: data.user.created_at,
          lastLoginAt: data.user.last_login_at,
        });
        const si: SessionInfo = {
          expiresAt: data.expires_at,
          sessionTimeoutMinutes: data.session_timeout_minutes,
          sessionWarningSeconds: data.session_warning_seconds,
        };
        setSessionInfo(si);
        startSessionTimers(si.expiresAt, si.sessionWarningSeconds);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [startSessionTimers]);

  useEffect(() => {
    checkSession();
    return () => clearTimers();
  }, [checkSession, clearTimers]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      if (IS_PREVIEW) {
        await new Promise(r => setTimeout(r, 400));
        if (!username || !password) {
          return { success: false, error: 'Usuário e senha são obrigatórios' };
        }
        // Simulate first-access flow for 'admin' with password 'admin'
        const mustChange = username === 'admin' && password === 'admin';
        const mockUser = { ...MOCK_USER, username, mustChangePassword: mustChange };
        const expiresAt = new Date(Date.now() + DEFAULT_SESSION_TIMEOUT_MINUTES * 60000).toISOString();
        const si: SessionInfo = {
          expiresAt,
          sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
          sessionWarningSeconds: DEFAULT_SESSION_WARNING_SECONDS,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: mockUser, sessionInfo: si }));
        setUser(mockUser);
        setSessionInfo(si);
        startSessionTimers(expiresAt, si.sessionWarningSeconds);
        return { success: true, mustChangePassword: mustChange };
      }

      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.detail || 'Credenciais inválidas' };
      }

      const data = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser({
        id: data.user.id,
        username: data.user.username,
        isActive: data.user.is_active,
        mustChangePassword: data.must_change_password,
        createdAt: data.user.created_at,
        lastLoginAt: data.user.last_login_at,
      });
      const si: SessionInfo = {
        expiresAt: data.expires_at,
        sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
        sessionWarningSeconds: DEFAULT_SESSION_WARNING_SECONDS,
      };
      setSessionInfo(si);
      startSessionTimers(si.expiresAt, si.sessionWarningSeconds);
      return { success: true, mustChangePassword: data.must_change_password };
    } catch {
      return { success: false, error: 'Falha na conexão com o servidor' };
    }
  }, [startSessionTimers]);

  const logout = useCallback(async () => {
    clearTimers();
    try {
      if (!IS_PREVIEW) {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        localStorage.removeItem(TOKEN_KEY);
      }
      sessionStorage.removeItem(SESSION_KEY);
      setUser(null);
      setSessionInfo(null);
      setShowSessionWarning(false);
    } catch {
      setUser(null);
    }
  }, [clearTimers]);

  const refreshSession = useCallback(async () => {
    try {
      if (IS_PREVIEW) {
        const newExpires = new Date(Date.now() + DEFAULT_SESSION_TIMEOUT_MINUTES * 60000).toISOString();
        const si: SessionInfo = {
          expiresAt: newExpires,
          sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
          sessionWarningSeconds: DEFAULT_SESSION_WARNING_SECONDS,
        };
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...parsed, sessionInfo: si }));
        }
        setSessionInfo(si);
        setShowSessionWarning(false);
        warningTriggeredRef.current = false;
        startSessionTimers(newExpires, si.sessionWarningSeconds);
        return true;
      }

      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return false;

      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const si = { ...sessionInfo!, expiresAt: data.expires_at };
        setSessionInfo(si);
        setShowSessionWarning(false);
        warningTriggeredRef.current = false;
        startSessionTimers(data.expires_at, si.sessionWarningSeconds);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [sessionInfo, startSessionTimers]);

  const dismissSessionWarning = useCallback(() => {
    refreshSession();
  }, [refreshSession]);

  const forceChangePassword = useCallback(async (newPassword: string) => {
    try {
      if (IS_PREVIEW) {
        await new Promise(r => setTimeout(r, 400));
        if (newPassword.length < 6) {
          return { success: false, error: 'Senha deve ter no mínimo 6 caracteres' };
        }
        const updatedUser = { ...user!, mustChangePassword: false };
        setUser(updatedUser);
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...parsed, user: updatedUser }));
        }
        return { success: true };
      }

      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${API_BASE}/api/auth/force-change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password: newPassword }),
      });

      if (res.ok) {
        setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
        return { success: true };
      }

      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.detail || 'Erro ao alterar senha' };
    } catch {
      return { success: false, error: 'Falha na conexão' };
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, sessionInfo, showSessionWarning, sessionSecondsLeft,
      login, logout, refreshSession, dismissSessionWarning, forceChangePassword, checkSession,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
