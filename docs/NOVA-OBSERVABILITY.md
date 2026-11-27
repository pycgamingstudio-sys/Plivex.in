# Nova request observability

`assistant-chat` emits one structured `nova_request_metric` log record per accepted request. The record contains only request ID, request class, provider/model labels, HTTP status, duration and timestamp. It does not include prompts, response text, workspace IDs, customer data or credentials.

## Fields
- `duration_ms`: end-to-end Edge Function time, including context reads and model response.
- `ttft_ms`: time to the first upstream model chunk for eligible streamed simple-chat turns; `null` for non-streamed requests.
- `request_class`: `simple` or `business`, derived from the existing request policy.
- `provider` / `model`: selected model route when generation succeeds.
- `status`: final HTTP status.

## Reporting
Filter Supabase Edge Function logs for `event = nova_request_metric`, then calculate p50/p95 over `duration_ms` separately for `request_class` and by time window. Do not claim a target is met until enough production samples exist and the measurement window is stated.

## Current streaming scope
- The client requests SSE only when the streaming UI is active.
- The Edge Function emits upstream Gemini text deltas only for simple conversational turns.
- Business/action/image requests keep the structured, validated final-response path; they do not expose speculative tool actions.
- A provider failure before the first emitted token can use the configured fallback. Once visible output has started, the request stops on interruption rather than switching providers and duplicating text.
- The final `complete` event carries the validated reply and pending-action/idempotency metadata. A streamed partial reply is never an authorization to write business data.

## Release acceptance gates
1. Deploy the matching `assistant-chat` Edge Function and frontend build as one coordinated release.
2. Verify authenticated SSE headers, first-token arrival, final `complete` payload, and non-stream JSON compatibility.
3. Verify a Main Workspace expense draft followed by typed `Yes` calls `assistant-confirm`, writes exactly one record, and shows it after refresh.
4. Verify negative and ambiguous confirmations do not call the confirmation endpoint.
5. Verify a stream interruption after visible output does not trigger a second provider or duplicate visible text.
6. Collect a documented production sample window before evaluating p50/p95 or quality targets.

## Limitation
The code and CI tests cover the streaming path, but the live deployed Edge Function is still version 84 and does not yet expose this SSE contract. TTFT/p50/p95 production targets are therefore not yet demonstrated. A successful CI run is not a substitute for authenticated production acceptance.