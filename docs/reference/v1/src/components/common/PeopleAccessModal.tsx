import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { User, Role } from '../../types';
import { Check, Shield, User as UserIcon, Building } from './Icons';

export const PeopleAccessModal: React.FC = () => {
  const { availableUsers, currentUser, setCurrentUser, closeInspector } = useApp();
  const { scopedUniverses } = useScopedData();
  const [selectedUser, setSelectedUser] = useState<User>(currentUser);

  const handleSwitchUser = (user: User) => {
    setSelectedUser(user);
    setCurrentUser(user);
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'cia':
        return <span className="px-2 py-0.5 text-apple-11 font-semibold rounded-md bg-verdigris-subtle text-verdigris border border-verdigris">Chief Audit Executive</span>;
      case 'reviewer':
        return <span className="px-2 py-0.5 text-apple-11 font-semibold rounded-md bg-accent-subtle text-accent border border-accent">Audit Reviewer (4-Eyes)</span>;
      case 'preparer':
        return <span className="px-2 py-0.5 text-apple-11 font-semibold rounded-md bg-surface-sunken text-primary border border-hairline">Audit Preparer</span>;
      case 'auditee':
        return <span className="px-2 py-0.5 text-apple-11 font-semibold rounded-md bg-cinnabar-subtle text-cinnabar border border-cinnabar">Entity Auditee</span>;
      case 'admin':
        return <span className="px-2 py-0.5 text-apple-11 font-semibold rounded-md bg-verdigris-subtle text-verdigris border border-verdigris">System Administrator</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <Shield className="w-4 h-4 text-verdigris" />
          <span>Role-Based Access Control (RBAC) &amp; Scope Impersonation</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Select an identity from the verified audit directory to simulate scoped visibility and gating permissions across the immutable ledger.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Active Personnel Directory
        </h3>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {availableUsers.map((user) => {
            const isCurrent = user.id === currentUser.id;
            return (
              <div
                key={user.id}
                onClick={() => handleSwitchUser(user)}
                className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                  isCurrent ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-surface-sunken border border-hairline flex items-center justify-center font-medium text-primary text-apple-13 shrink-0">
                    {user.avatar ? (
                      <span className="font-semibold">{user.name.split(' ').map((n) => n[0]).join('')}</span>
                    ) : (
                      <UserIcon className="w-4 h-4 text-secondary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-apple-13 font-medium text-primary truncate">{user.name}</span>
                      {isCurrent && (
                        <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Active
                        </span>
                      )}
                    </div>
                    <div className="text-apple-11 text-secondary truncate flex items-center gap-2 mt-0.5">
                      <span>{user.email}</span>
                      {user.department && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Building className="w-3 h-3" /> {user.department}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 pl-3">
                  {getRoleBadge(user.role)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-4 border-t border-hairline flex justify-end">
        <button
          type="button"
          onClick={closeInspector}
          className="px-4 py-2 text-apple-13 font-medium rounded-lg bg-surface border border-hairline text-primary hover:bg-surface-hover transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};
