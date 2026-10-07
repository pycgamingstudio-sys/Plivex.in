import { backend as db } from '@/api/backendClient';

import { useState } from 'react';

import { membershipRequestError } from '@/components/team/teamResponse';

export default function useTeamActions(refetch) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invitation, setInvitation] = useState(null);
  const run = async (operation, payload, success) => {
    setBusy(true); setError('');
    try {
      const response = await db.functions.invoke(operation, payload);
      if (!response.data?.ok) throw new Error(response.data?.error || 'The membership change was not confirmed.');
      if (success) success(response.data);
      await refetch();
      return true;
    } catch (cause) {
      const failure = membershipRequestError(cause);
      console.error('[Workspace membership change]', { status: failure.status, message: failure.message, operation, requestId: failure.requestId });
      setError(`${failure.status ? `HTTP ${failure.status}: ` : ''}${failure.message}`);
      await refetch();
      return false;
    } finally { setBusy(false); }
  };
  return {
    busy, error, invitation, clearError: () => setError(''),
    addMember: details => run('sendTeamInvite', { to: details.email, name: details.name, role: details.role, workspaceName: 'Plivex' }, result => setInvitation({ email: result.sentTo, code: result.code, warning: result.warning, emailSent: result.emailSent })),
    updateRole: (member, role) => run('manageWorkspaceMember', { memberId: member.id, action: 'changeRole', role }),
    removeMember: member => window.confirm(`Remove ${member.name} from the workspace?`) && run('manageWorkspaceMember', { memberId: member.id, action: 'remove' }),
  };
}