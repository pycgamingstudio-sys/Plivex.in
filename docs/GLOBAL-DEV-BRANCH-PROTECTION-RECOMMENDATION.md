# Recommended GitHub branch protection — global-dev

This is a recommendation only. Repository settings have not been changed.

Apply after Chat 4 explicitly authorizes repository-settings changes.

## Ruleset / branch protection

Target branch: `global-dev`

- Require a pull request before merging; require at least one independent approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require status checks before merge:
  - `Global Foundation CI`
  - `PostgreSQL Subscription Integration`
  - `Stage 4 Remediation Verification / Disposable migration replay and India data integrity`
  - `Stage 4 Remediation Verification / Real GoTrue Auth plus Cashfree handler and PostgREST`
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Restrict direct pushes to authorized maintainers.
- Do not apply this ruleset to `main` as part of Stage 4; production/India controls are outside this authorization.

## Operational notes

- Confirm exact status-check context names from successful GitHub Actions runs before enabling enforcement.
- Keep workflow permissions least-privilege; verification jobs need read-only repository access.
- Use GitHub Actions secrets only for legitimate Cashfree Sandbox credentials after they are issued. No Live credentials belong in this workflow.
- Record the ruleset ID, enabled date, and reviewer when separately authorized and applied.
