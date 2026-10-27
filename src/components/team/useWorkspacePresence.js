import { backend as db } from '@/api/backendClient';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { membershipRequestError, retryMembership, membershipRetryDelay } from '@/components/team/teamResponse';

export default function useWorkspacePresence(team) {
  const { user } = useAuth();
  const userIds = [...new Set((team?.members || [])
    .filter(member => member.status === 'active' && typeof member.user_id === 'string')
    .map(member => member.user_id))];
  const key = ['workspace-presence', user?.id, user?.workspace_id, userIds.join(',')];
  return useQuery({
    queryKey: key,
    enabled: !!team && userIds.length > 0,
    queryFn: async () => {
      try {
        const result = await db.functions.invoke('getTeamPresence', { userIds });
        const rows = Array.isArray(result?.data?.members) ? result.data.members : [];
        const now = Date.now();
        const presence = {};
        for (const row of rows) {
          if (!row?.created_by_id) continue;
          const ping = row.last_ping_at ? new Date(row.last_ping_at).getTime() : NaN;
          const elapsed = Number.isFinite(ping) ? Math.max(0, now - ping) : Infinity;
          const status = elapsed < 2 * 60_000 ? 'online' : elapsed < 10 * 60_000 ? 'idle' : 'offline';
          presence[row.created_by_id] = { ...row, status, elapsed };
        }
        return presence;
      } catch (cause) {
        const error = membershipRequestError(cause);
        error.operation = 'staff presence';
        console.error('[Staff presence]', { status: error.status, message: error.message });
        throw error;
      }
    },
    retry: retryMembership,
    retryDelay: membershipRetryDelay,
    refetchInterval: 30000,
  });
}
