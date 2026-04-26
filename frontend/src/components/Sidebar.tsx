import React from 'react';
import { LayoutDashboard, TrendingUp, Waves, Target, Settings, X } from 'lucide-react';

interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab = 'overview',
  onTabChange,
  isMobileOpen = false,
  onMobileClose,
}) => {
  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={20} /> },
    { id: 'buy', label: 'BUY Signals', icon: <TrendingUp size={20} /> },
    { id: 'whale', label: 'Whale Activity', icon: <Waves size={20} /> },
    { id: 'floor', label: 'Near Floor', icon: <Target size={20} /> },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[72px] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex-col items-center py-4 gap-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange?.(item.id)}
            className={`relative w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 group ${
              activeTab === item.id
                ? 'bg-[var(--whale)]/20 text-[var(--whale)] shadow-[0_0_20px_rgba(147,52,230,0.12)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
            title={item.label}
          >
            {item.icon}
            {activeTab === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[var(--whale)] rounded-r-full" />
            )}
            {/* Tooltip */}
            <div className="absolute left-full ml-3 px-2 py-1 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-xs text-[var(--text-primary)] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-theme">
              {item.label}
            </div>
          </button>
        ))}

        <div className="flex-1" />

        {/* Settings */}
        <button
          className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-50"
          onClick={onMobileClose}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 w-64 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] z-50 transform transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-[var(--whale)] to-[var(--floor)] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">R</span>
            </div>
            <span className="font-bold text-[var(--text-primary)]">Remora</span>
          </div>
          <button
            onClick={onMobileClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onTabChange?.(item.id);
                onMobileClose?.();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                activeTab === item.id
                  ? 'bg-[var(--whale)]/20 text-[var(--whale)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {item.icon}
              <span className="font-medium">{item.label}</span>
              {item.badge && (
                <span className="ml-auto bg-[var(--whale)] text-white text-xs px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-14 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-around z-40">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange?.(item.id)}
            className={`flex flex-col items-center gap-0.5 py-2 px-4 transition-colors ${
              activeTab === item.id
                ? 'text-[var(--whale)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            {item.icon}
            <span className="text-[10px]">{item.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>
    </>
  );
};

export default Sidebar;
