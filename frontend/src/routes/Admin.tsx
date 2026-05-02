import React, { useState } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { KeyRound, RefreshCw, Users, ScrollText } from 'lucide-react';
import { CredentialsTab } from './admin/CredentialsTab';
import { SyncTab } from './admin/SyncTab';
import { MembersTab } from './admin/MembersTab';
import { LogsTab } from './admin/LogsTab';

const tabs = [
  { to: 'credentials', label: 'Credentials', icon: KeyRound },
  { to: 'sync',        label: 'Sync',        icon: RefreshCw },
  { to: 'members',     label: 'Members',     icon: Users },
  { to: 'logs',        label: 'Logs',        icon: ScrollText },
];

export const Admin: React.FC = () => {
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4500);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">Admin</h1>

      <nav className="flex gap-1 border-b border-border overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? 'border-buy text-text'
                  : 'border-transparent text-sub hover:text-text'
              }`
            }
          >
            <Icon size={14} /> {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1">
        <Routes>
          <Route index                element={<Navigate to="credentials" replace />} />
          <Route path="credentials"   element={<CredentialsTab toast={toast} />} />
          <Route path="sync"          element={<SyncTab toast={toast} />} />
          <Route path="members"       element={<MembersTab toast={toast} />} />
          <Route path="logs"          element={<LogsTab />} />
        </Routes>
      </div>

      {toastMsg && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border border-border rounded-lg px-4 py-2.5 text-sm shadow-xl max-w-md text-center">
          {toastMsg}
        </div>
      )}
    </div>
  );
};
