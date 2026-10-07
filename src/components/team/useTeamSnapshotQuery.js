import { backend as db } from '@/api/backendClient';

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/lib/AuthContext';
import { validateTeamResponse, membershipRequestError, retryMembership, membershipRetryDelay } from '@/components/team/teamResponse';

export default function useTeamSnapshotQuery() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['workspace-team', user?.id, user?.workspace_id, 'contract-v1'],
    enabled: user?.role === 'admin' && !!user?.workspace_id,
    queryFn: async () => {
      try {
        return validateTeamResponse(await db.functions.invoke('getWorkspaceTeam', {}), user.workspace_id);
      } catch (cause) {
        const error = membershipRequestError(cause);
        console.error('[Workspace members]', { status: error.status, message: error.message, operation: error.operation, requestId: error.requestId });
        throw error;
      }
    },
    retry: retryMembership,
    retryDelay: membershipRetryDelay,
    staleTime: 15000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const missingWorkspace = user?.role === 'admin' && !user?.workspace_id;
  const error = missingWorkspace ? Object.assign(new Error('Your account is not linked to a workspace.'), { status: 409 }) : query.error;
  const retrying = query.isFetching && query.failureCount > 0;
  return { ...query, error, data: error || retrying ? undefined : query.data,   isPending: !missingWorkspace && (query.isLoading || retrying), retryAttempt: query.failureCount };
}