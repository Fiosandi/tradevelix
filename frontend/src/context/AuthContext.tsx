import React, { createContext, useContext, useState, useEffect } from 'react';
import http from '../api';

interface AuthUser { username: string; email: string; token: string; is_admin: boolean; is_paid: boolean }
interface AuthCtx {
  user: AuthUser | null;
  login:    (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout:   () => void;
  loading:  boolean;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

const KEY  = 'tradevelix_token';
const UKEY = 'tradevelix_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]     = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(UKEY) || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(KEY);
    if (token) http.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }, []);

  const saveUser = (data: any) => {
    const u: AuthUser = {
      username: data.username,
      email:    data.email,
      token:    data.access_token,
      is_admin: !!data.is_admin,
      is_paid:  !!data.is_paid,
    };
    localStorage.setItem(KEY,  data.access_token);
    localStorage.setItem(UKEY, JSON.stringify(u));
    http.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;
    setUser(u);
  };

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await http.post('/auth/login', { email, password });
      saveUser(data);
    } finally { setLoading(false); }
  };

  const register = async (email: string, username: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await http.post('/auth/register', { email, username, password });
      saveUser(data);
    } finally { setLoading(false); }
  };

  const logout = () => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(UKEY);
    delete http.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, register, logout, loading }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
