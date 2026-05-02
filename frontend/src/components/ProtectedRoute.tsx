import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  adminOnly?: boolean;
}> = ({ children, adminOnly }) => {
  const { user } = useAuth();
  const loc = useLocation();

  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;

  if (adminOnly && !user.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-4">
        <ShieldAlert size={32} className="text-watch mb-3" />
        <h2 className="text-lg font-bold mb-1">Admin access required</h2>
        <p className="text-sm text-sub max-w-md mb-4">
          Your account <span className="text-text font-mono">{user.username}</span> is not flagged as an admin.
          If you should be one, sign out and back in to refresh your token, or have an admin
          set <span className="font-mono text-floor">is_admin=true</span> for your user in the database.
        </p>
        <Link to="/" className="text-sm text-floor hover:underline">← Back to watchlist</Link>
      </div>
    );
  }

  return <>{children}</>;
};
