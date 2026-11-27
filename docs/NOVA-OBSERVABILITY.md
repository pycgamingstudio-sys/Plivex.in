# Nova request observability

`assistant-chat` emits one structured `nova_request_metric` log record per accepted request. The record contains only request ID, request class, provider/model labels, HTTP status, duration and timestamp. It does not include prompts, response text, workspace IDs, customer data or credentials.

## Fields
- `duration_ms`: end-to-end Edge Function time, including context reads and model response.
- `request_class`: `simple` or `business`, derived from the existing request policy.
- `provider` / `model`: selected model route when generation succeeds.
- `status`: final HTTP status.

## Reporting
Filter Supabase Edge Function logs for `event = nova_request_metric`, then calculate p50/p95 over `duration_ms` separately for `request_class` and by time window. Do not claim a target is met until enough production samples exist and the measurement window is stated.

## Limitation
This is full-response latency, not token time-to-first-token (TTFT). TTFT becomes meaningful only after actual server-sent token streaming is implemented and measured from the first emitted model token.