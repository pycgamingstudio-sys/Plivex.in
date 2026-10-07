import { backend as db } from '@/api/backendClient';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/AuthContext';
import { membershipRequestError, retryMembership, membershipRetryDelay } from '@/components/team/teamResponse';

export default function useWorkspacePresence(team) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userIds = (team?.members || []).filter(member => member.status === 'active').map(member => member.user_id);
  const key = ['workspace-presence', user?.id, user?.workspace_id, userIds.join(',')];
  const query = useQuery({
    queryKey: key,
    enabled: !!team && userIds.length > 0,
    queryFn: async () => {
      try {
        const page = await db.entities.StaffActivity.filter({ workspace_id: user.workspace_id, created_by_id: { $in: userIds } }, { sort: '-updated_date', limit: 1000 });
        const presence = {};
        for (const record of page.items) if (!presence[record.created_by_id]) presence[record.created_by_id] = record;
        return presence;
      } catch (cause) {
        const error = membershipRequestError(cause);
        error.operation = 'staff presence';
        console.error('[Staff presence]', { status: error.status, message: error.message });
        throw error;
      }
    },
    retry: retryMembership, retryDelay: membershipRetryDelay, refetchInterval: 30000,
  });
  useEffect(() => {
    if (!team) return;
    return db.entities.StaffActivity.subscribe(event => {
      if (event.type === 'delete' || event.data?.workspace_id === user.workspace_id) queryClient.invalidateQueries({ queryKey: ['workspace-presence', user.id, user.workspace_id] });
    });
  }, [!!team, user?.id, user?.workspace_id, queryClient]);
  return query;
}