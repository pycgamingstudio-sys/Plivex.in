import { useContext } from 'react';
import { WorkspaceTeamContext } from '@/components/team/WorkspaceTeamProvider';

export default function useWorkspaceTeam() {
  const membership = useContext(WorkspaceTeamContext);
  if (!membership) throw new Error('Workspace membership must be read through the shared provider.');
  return membership;
}