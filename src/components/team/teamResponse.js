export function membershipRequestError(error) {
  const body = error.response?.data || error.data || {};
  return Object.assign(new Error(typeof body.error === 'string' ? body.error : body.message || error.message || 'Network request failed.'), {
    status: body.status || error.response?.status || error.status || 0,
    operation: body.operation || error.operation || 'getWorkspaceTeam',
    requestId: body.requestId || error.requestId || '',
  });
}
export function validateTeamResponse(response, workspaceId) {
  // Read one transport envelope, or retain a payload that was already decoded.
  const data = response?.data ?? response;
  if (!data || !Array.isArray(data.members) || !data.counts || data.schemaVersion !== 1) {
    const received = data && typeof data === 'object' ? `fields: ${Object.keys(data).slice(0, 12).join(', ') || 'none'}` : typeof data;
    throw Object.assign(new Error(`Invalid membership response: expected member list, counts, and version 1; received ${received}.`), { status: 502, operation: 'response validation', requestId: data?.requestId || '' });
  }
  if (data.workspaceId !== workspaceId) throw Object.assign(new Error(`Workspace mismatch: expected ${workspaceId}, received ${data.workspaceId || '(missing)'}.`), { status: 409, operation: 'response validation' });
  const countKeys = ['admin', 'manager', 'employee', 'storekeeper', 'accountant', 'pending', 'accepted', 'active'];
  if (data.totalMembers !== data.members.length || !countKeys.every(key => Number.isInteger(data.counts[key]) && data.counts[key] >= 0)) throw Object.assign(new Error('Invalid membership response: member totals or role counts are missing or invalid.'), { status: 502, operation: 'response validation', requestId: data.requestId || '' });
  return data;
}
export const retryMembership = (attempt, error) => attempt < 3 && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
export const membershipRetryDelay = attempt => Math.min(500 * 2 ** attempt, 4000);