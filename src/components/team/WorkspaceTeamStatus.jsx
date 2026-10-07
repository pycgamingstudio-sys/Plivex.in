import { Loader2 } from 'lucide-react';

export default function WorkspaceTeamStatus({ loading, onRetry, error, retryAttempt = 0 }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground" role={loading ? 'status' : 'alert'}>
      {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{retryAttempt ? `Retrying workspace members… attempt ${retryAttempt + 1} of 4` : 'Loading workspace members…'}</span> : <>
        <p className="font-semibold text-destructive">Workspace membership unavailable{error?.operation === 'response validation' ? ' (response format)' : error?.status ? ` (HTTP ${error.status})` : ' (network error)'}</p>
        <p className="mt-2 break-words">{error?.message || 'No valid membership response was received.'}</p>
        {error?.operation && <p className="mt-1 text-xs">Step: {error.operation}</p>}
        {error?.requestId && <p className="mt-1 text-xs">Reference: {error.requestId}</p>}
        <p className="mt-2 text-xs">Both member counts and the list are unavailable; no cached invite counts are substituted.</p>
        {onRetry && <button onClick={onRetry} className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Try again</button>}
      </>}
    </div>
  );
}