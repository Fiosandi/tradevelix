import React from 'react';
import { Fish, Search, Bell, User, Menu, Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.tsx';

interface HeaderProps {
  onMenuClick?: () => void;
  showMobileMenu?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, showMobileMenu = false }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-16 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        {showMobileMenu && (
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
          >
            <Menu size={20} />
          </button>
        )}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[var(--whale)] to-[var(--floor)] rounded-xl flex items-center justify-center shadow-lg">
            <Fish className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">Remora</h1>
            <p className="text-[10px] text-[var(--text-muted)] -mt-0.5">Trading Tools</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search - Hidden on mobile */}
        <button className="hidden md:flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-color)]">
          <Search size={18} />
          <span className="text-sm hidden lg:inline">Search stocks...</span>
          <span className="text-xs text-[var(--text-muted)] hidden xl:inline bg-[var(--bg-overlay)] px-1.5 py-0.5 rounded">⌘K</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-color)]"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? (
            <Moon size={20} />
          ) : (
            <Sun size={20} />
          )}
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-color)]">
          <Bell size={20} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--bullish)] rounded-full" />
        </button>

        {/* User Profile */}
        <button className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-color)]">
          <div className="w-8 h-8 rounded-lg bg-[var(--whale)]/20 flex items-center justify-center">
            <User size={16} className="text-[var(--whale)]" />
          </div>
          <span className="hidden md:inline text-sm text-[var(--text-primary)]">Trader</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
