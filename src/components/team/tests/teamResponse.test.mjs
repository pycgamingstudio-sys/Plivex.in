import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTeamResponse, membershipRequestError, retryMembership, membershipRetryDelay } from '../teamResponse.js';

const snapshot = {
  schemaVersion: 1, workspaceId: 'WS-TEST',
  members: [{ id: 'member-owner', user_id: 'owner', name: 'Owner', email: 'owner@example.com', role: 'admin', status: 'active' }],
  counts: { admin: 1, manager: 0, employee: 0, storekeeper: 0, accountant: 0, pending: 0, accepted: 0, active: 1 },
  totalMembers: 1, teammateCount: 0, requestId: 'request-test',
};

test('accepts the SDK Axios response without changing the server snapshot', () => {
  assert.equal(validateTeamResponse({ data: snapshot, status: 200 }, 'WS-TEST'), snapshot);
});
test('accepts an already-decoded SDK response without unwrapping it twice', () => {
  assert.equal(validateTeamResponse(snapshot, 'WS-TEST'), snapshot);
});
test('rejects responses with missing or unsupported membership contracts', () => {
  for (const response of [undefined, null, {}, { data: '<html>not team data</html>' }, { data: { members: [] } }, { data: { ...snapshot, schemaVersion: 2 } }]) {
    assert.throws(() => validateTeamResponse(response, 'WS-TEST'), { status: 502, operation: 'response validation' });
  }
});
test('never accepts another workspace, even when the member-list contract is valid', () => {
  assert.throws(() => validateTeamResponse({ data: snapshot }, 'WS-OTHER'), { status: 409 });
  assert.throws(() => validateTeamResponse(snapshot, 'WS-OTHER'), { status: 409 });
});
test('does not manufacture zero counts from an incomplete response', () => {
  for (const counts of [{}, { admin: 1 }, { ...snapshot.counts, manager: -1 }, { ...snapshot.counts, accountant: '0' }]) {
    assert.throws(() => validateTeamResponse({ data: { ...snapshot, counts } }, 'WS-TEST'), { status: 502 });
  }
  assert.throws(() => validateTeamResponse({ data: { ...snapshot, totalMembers: 9 } }, 'WS-TEST'), { status: 502 });
});
test('preserves real permission errors and their request references', () => {
  const failure = membershipRequestError({ response: { status: 403, data: { error: 'Access denied', operation: 'membership read', requestId: 'denied-test' } } });
  assert.equal(failure.status, 403); assert.equal(failure.message, 'Access denied');
  assert.equal(failure.operation, 'membership read'); assert.equal(failure.requestId, 'denied-test');
  assert.equal(retryMembership(0, failure), false);
});
test('preserves SDK errors whose details are on error.data', () => {
  const failure = membershipRequestError({ status: 503, message: 'Request failed', data: { error: 'Team temporarily unavailable', operation: 'membership read', requestId: 'service-test' } });
  assert.equal(failure.message, 'Team temporarily unavailable'); assert.equal(failure.requestId, 'service-test');
});
test('invalid response details include format and request reference for diagnosis', () => {
  assert.throws(() => validateTeamResponse({ data: { requestId: 'bad-contract', result: [] } }, 'WS-TEST'), error => error.status === 502 && error.requestId === 'bad-contract' && error.message.includes('fields: requestId, result'));
});
test('retry remains bounded and backs off only for transient failures', () => {
  assert.equal(retryMembership(2, { status: 503 }), true);
  assert.equal(retryMembership(3, { status: 503 }), false);
  assert.equal(retryMembership(0, { status: 401 }), false);
  assert.deepEqual([0, 1, 2].map(membershipRetryDelay), [500, 1000, 2000]);
});