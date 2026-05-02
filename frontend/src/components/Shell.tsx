import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FlaskConical, Bell, Settings, Sun, Moon, LogOut, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';

const navItems = [
  { to: '/',        label: 'Watch',  icon: LayoutDashboard },
  { to: '/lab',     label: 'Lab',    icon: FlaskConical },
  { to: '/alerts',  label: 'Alerts', icon: Bell },
];

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const nav = useNavigate();

  const items = [...navItems];
  if (user?.is_admin) items.push({ to: '/admin', label: 'Admin', icon: Settings });

  return (
    <div className="min-h-full bg-bg text-text flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface">
        <div className="px-5 py-5 flex items-center gap-2">
          <TrendingUp size={20} className="text-buy" />
          <span className="font-bold text-base tracking-tight">Tradevelix</span>
        </div>
        <nav className="flex-1 px-3 flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-card text-text'
                    : 'text-sub hover:bg-card-hi hover:text-text'
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-sub hover:bg-card-hi hover:text-text"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {user && (
            <button
              onClick={() => { logout(); nav('/login'); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-sub hover:bg-sell-dim hover:text-sell"
            >
              <LogOut size={14} /> Sign out
              <span className="ml-auto text-[10px] text-muted truncate">{user.username}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-16 md:pb-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-buy" />
            <span className="font-bold text-sm tracking-tight">Tradevelix</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-sub hover:bg-card-hi"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {user && (
              <button
                onClick={() => { logout(); nav('/login'); }}
                className="p-2 rounded-lg text-sub hover:bg-sell-dim hover:text-sell"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </header>

        <div className="px-4 py-4 md:px-8 md:py-6">{children}</div>

        {/* Mobile bottom nav */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur grid"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 text-[10px] font-semibold uppercase tracking-wide ${
                  isActive ? 'text-buy' : 'text-sub'
                }`
              }
            >
              <Icon size={18} />
              <span className="mt-0.5">{label}</span>
            </NavLink>
          ))}
        </nav>
      </main>
    </div>
  );
};
