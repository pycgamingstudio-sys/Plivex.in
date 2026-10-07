import { backend as db } from '@/api/backendClient';

import { createContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/AuthContext';
import useTeamSnapshotQuery from '@/components/team/useTeamSnapshotQuery';

export const WorkspaceTeamContext = createContext(null);
export default function WorkspaceTeamProvider({ children }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const membership = useTeamSnapshotQuery();
  useEffect(() => {
    if (user?.role !== 'admin' || !user?.workspace_id) return;
    return db.entities.WorkspaceMember.subscribe(event => {
      if (event.type === 'delete' || (event.data?.workspace_id === user.workspace_id && event.data?.owner_id === user.id)) {
        queryClient.invalidateQueries({ queryKey: ['workspace-team', user.id, user.workspace_id] });
      }
    });
  }, [user?.id, user?.workspace_id, user?.role, queryClient]);
  return <WorkspaceTeamContext.Provider value={membership}>{children}</WorkspaceTeamContext.Provider>;
}