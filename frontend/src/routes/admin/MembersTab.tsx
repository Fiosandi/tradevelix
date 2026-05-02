import React, { useCallback, useEffect, useState } from 'react';
import { dashboardApi } from '../../api';
import { fmtTs } from '../../lib/fmt';

interface Member {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  is_paid: boolean;
  created_at: string;
}

export const MembersTab: React.FC<{ toast: (msg: string) => void }> = ({ toast }) => {
  const [users, setUsers] = useState<Member[]>([]);
  const [busy, setBusy]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await dashboardApi.getAdminUsers()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const togglePaid = async (id: string) => {
    setBusy(id);
    try { await dashboardApi.toggleUserPaid(id); load(); }
    catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted font-bold">
            <tr>
              <th className="text-left  px-4 py-3">User</th>
              <th className="text-left  px-4 py-3 hidden md:table-cell">Email</th>
              <th className="text-left  px-4 py-3 hidden md:table-cell">Joined</th>
              <th className="text-right px-4 py-3">Paid</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-sub">No users yet</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="font-semibold">{u.username}</div>
                  {u.is_admin && <span className="text-[9px] uppercase tracking-wider text-watch font-bold">admin</span>}
                  <div className="md:hidden text-[10px] text-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3 text-sub hidden md:table-cell">{u.email}</td>
                <td className="px-4 py-3 text-sub hidden md:table-cell">{fmtTs(u.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => togglePaid(u.id)}
                    disabled={busy === u.id}
                    className={`text-[10px] font-bold px-2 py-1 rounded border ${
                      u.is_paid
                        ? 'bg-buy-dim text-buy border-buy/30'
                        : 'bg-wait-dim text-sub border-border'
                    } disabled:opacity-50`}
                  >
                    {u.is_paid ? 'PAID' : 'FREE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
