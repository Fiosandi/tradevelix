import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, TrendingDown, Eye,
  ChevronLeft, ChevronRight, Sun, Moon, BarChart2, Settings, Search, LogOut, FlaskConical, Activity, Radio, PieChart, Bell,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../context/AuthContext';

// ─── Nav groups ───────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  exact?: boolean;
  color?: string;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard',   icon: <LayoutDashboard size={15} />, path: '/dashboard', exact: true },
    ],
  },
  {
    label: 'Signals',
    items: [
      { label: 'BUY Signals', icon: <TrendingUp size={15} />,  path: '/dashboard?filter=buy',   color: 'var(--buy)' },
      { label: 'Signals',     icon: <Radio size={15} />,       path: '/signals',                color: 'var(--buy)', exact: true },
      { label: 'Alerts',      icon: <Bell size={15} />,        path: '/alerts',                 color: 'var(--watch)', exact: true },
      { label: 'WATCH',       icon: <Eye size={15} />,          path: '/dashboard?filter=watch', color: 'var(--watch)' },
      { label: 'SELL / Exit', icon: <TrendingDown size={15} />, path: '/dashboard?filter=sell',  color: 'var(--sell)' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Whale Flow',    icon: <BarChart2 size={15} />,     path: '/dashboard?filter=whale', color: 'var(--whale)' },
      { label: 'Inventory',     icon: <Activity size={15} />,      path: '/broker-flow', color: '#22d3ee', exact: true },
      { label: 'Ownership',     icon: <PieChart size={15} />,      path: '/ownership',   color: 'var(--watch)' },
      { label: 'Backtest',      icon: <FlaskConical size={15} />,  path: '/backtest',    color: 'var(--floor)', exact: true },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Admin', icon: <Settings size={15} />, path: '/admin', color: 'var(--floor)' },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const Sidebar: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const W = collapsed ? 58 : 230;

  const isActive = (path: string, exact?: boolean) => {
    const [p, q] = path.split('?');
    if (exact) return pathname === p;
    if (q) return pathname === p && window.location.search === '?' + q;
    return pathname.startsWith(p);
  };

  return (
    <aside style={{
      width: W, flexShrink: 0,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.22s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center',
        padding: '0 18px', gap: 10,
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🦈</span>
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>Tradevelix</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.08em', marginTop: 2 }}>IDX SMART MONEY</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {NAV_GROUPS.map(group => (
          <div key={group.label} style={{ marginBottom: 4 }}>
            {!collapsed && (
              <div style={{
                fontSize: 9, fontWeight: 700, color: 'var(--muted)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '10px 18px 4px',
              }}>
                {group.label}
              </div>
            )}
            {collapsed && <div style={{ height: 8 }} />}

            {group.items.map(item => {
              const active = isActive(item.path, item.exact);
              return (
                <button
                  key={item.path + item.label}
                  onClick={() => navigate(item.path)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: 10, padding: collapsed ? '9px 18px' : '8px 14px 8px 18px',
                    background: active ? 'var(--buy-dim)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    color: active ? 'var(--buy)' : (item.color ?? 'var(--sub)'),
                    fontWeight: active ? 600 : 400,
                    fontSize: 13,
                    textAlign: 'left',
                    transition: 'all 0.1s',
                    borderLeft: `2px solid ${active ? 'var(--buy)' : 'transparent'}`,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--card-hi)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}>{item.icon}</span>
                  {!collapsed && item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User + collapse */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {!collapsed && user && (
          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--floor), var(--whale))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
            }}>
              {user.username?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
            <button
              onClick={() => { logout(); navigate('/'); }}
              title="Sign out"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--sell)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
        <button
          onClick={onToggle}
          style={{
            width: '100%', height: 40,
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-end',
            paddingRight: collapsed ? 0 : 16,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', transition: 'color 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--sub)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
        >
          {collapsed
            ? <ChevronRight size={15} />
            : <><span style={{ fontSize: 11, marginRight: 6 }}>Collapse</span><ChevronLeft size={15} /></>}
        </button>
      </div>
    </aside>
  );
};

// ─── Top nav ──────────────────────────────────────────────────────────────────

interface TopNavProps { subtitle?: string; ticker?: string; title?: string }

export const TopNav: React.FC<TopNavProps> = ({ subtitle, ticker }) => {
  const { theme, toggleTheme } = useTheme();
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  return (
    <div style={{
      height: 56, flexShrink: 0,
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 16,
    }}>
      {/* Breadcrumb */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          onClick={() => navigate('/dashboard')}
          style={{ fontSize: 13, color: 'var(--sub)', cursor: 'pointer', transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--sub)')}
        >Dashboard</span>
        {ticker && (
          <>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{ticker}</span>
          </>
        )}
        {subtitle && (
          <span style={{
            marginLeft: 8, fontSize: 10, color: 'var(--sub)',
            background: 'var(--card)', border: '1px solid var(--border)',
            padding: '2px 8px', borderRadius: 5, fontFamily: 'monospace',
          }}>{subtitle}</span>
        )}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Search size={13} style={{ position: 'absolute', left: 10, color: 'var(--muted)', pointerEvents: 'none' }} />
        <input
          placeholder="Search ticker..."
          style={{
            width: 180, height: 32, background: 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '0 10px 0 30px', fontSize: 12, color: 'var(--text)',
            outline: 'none', transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--floor)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim().toUpperCase();
              if (v) { navigate(`/stock/${v}`); (e.target as HTMLInputElement).value = ''; }
            }
          }}
        />
      </div>

      {/* Admin quick-access (admin users only) */}
      {(user as any)?.is_admin && (
        <button
          onClick={() => navigate('/admin')}
          title="Admin Panel"
          style={{
            height: 32, padding: '0 12px', borderRadius: 8,
            background: 'var(--floor-dim)', border: '1px solid var(--floor)',
            color: 'var(--floor)', cursor: 'pointer', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget.style.background = 'var(--floor)'); (e.currentTarget.style.color = 'white'); }}
          onMouseLeave={e => { (e.currentTarget.style.background = 'var(--floor-dim)'); (e.currentTarget.style.color = 'var(--floor)'); }}
        >
          <Settings size={12} /> Admin
        </button>
      )}

      {/* Sign out */}
      <button
        onClick={() => { logout(); navigate('/'); }}
        title="Sign out"
        style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sub)', cursor: 'pointer', transition: 'all 0.15s' }}
        onMouseEnter={e => { (e.currentTarget.style.color = 'var(--sell)'); }}
        onMouseLeave={e => { (e.currentTarget.style.color = 'var(--sub)'); }}
      ><LogOut size={13} /></button>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--card)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--sub)', cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget.style.color = 'var(--text)'); (e.currentTarget.style.borderColor = 'var(--border-hi)'); }}
        onMouseLeave={e => { (e.currentTarget.style.color = 'var(--sub)'); (e.currentTarget.style.borderColor = 'var(--border)'); }}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </div>
  );
};

// ─── Layout ───────────────────────────────────────────────────────────────────

interface LayoutProps { children: React.ReactNode; subtitle?: string; ticker?: string; title?: string }

export const Layout: React.FC<LayoutProps> = ({ children, title, subtitle, ticker }) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <TopNav title={title} subtitle={subtitle} ticker={ticker} />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg)' }}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
