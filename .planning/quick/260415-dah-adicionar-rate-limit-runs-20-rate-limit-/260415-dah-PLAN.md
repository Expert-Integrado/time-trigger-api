---
phase: quick-260415-dah
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .env
autonomous: true
requirements:
  - QUICK-260415-DAH-01
must_haves:
  truths:
    - ".env contains RATE_LIMIT_RUNS=20"
    - ".env contains RATE_LIMIT_FUP=20"
    - ".env contains RATE_LIMIT_MESSAGES=20"
    - "Pre-existing env vars in .env remain untouched (MONGODB_URI, CRON_INTERVAL_*, TZ, PORT)"
    - "When the app boots, RunDispatchService.rateLimitRuns/rateLimitFup/rateLimitMessages evaluate to 20 instead of the default 10"
  artifacts:
    - path: ".env"
      provides: "Runtime environment configuration including rate limit overrides"
      contains: "RATE_LIMIT_RUNS=20"
  key_links:
    - from: ".env"
      to: "src/dispatch/run-dispatch.service.ts"
      via: "process.env['RATE_LIMIT_RUNS'] / RATE_LIMIT_FUP / RATE_LIMIT_MESSAGES reads at lines 35-46"
      pattern: "RATE_LIMIT_(RUNS|FUP|MESSAGES)=20"
---

<objective>
Raise the per-database per-cycle dispatch ceiling for runs, FUPs, and messages from the default 10 to 20 by adding `RATE_LIMIT_RUNS=20`, `RATE_LIMIT_FUP=20`, and `RATE_LIMIT_MESSAGES=20` to `.env`.

Purpose: Increase throughput per cycle per database without any code changes. The values are already consumed by `RunDispatchService` via `parseInt(process.env[...] ?? '10', 10)` at lines 35-46 of `src/dispatch/run-dispatch.service.ts` — only the `.env` file needs to be updated.

Output: Updated `.env` file containing the three new rate-limit entries alongside the existing configuration.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@.env
@src/dispatch/run-dispatch.service.ts

<interfaces>
<!-- Env vars consumed by RunDispatchService (src/dispatch/run-dispatch.service.ts lines 35-46) -->

```ts
private readonly rateLimitRuns = parseInt(
  process.env['RATE_LIMIT_RUNS'] ?? '10',
  10,
);
private readonly rateLimitFup = parseInt(
  process.env['RATE_LIMIT_FUP'] ?? '10',
  10,
);
private readonly rateLimitMessages = parseInt(
  process.env['RATE_LIMIT_MESSAGES'] ?? '10',
  10,
);
```

Current `.env` contents (must be preserved as-is):

```
MONGODB_URI=mongodb://...
CRON_INTERVAL_RUNS=10000
CRON_INTERVAL_FUP=10000
CRON_INTERVAL_MESSAGES=10000
CRON_INTERVAL_RECOVERY=60000
TZ=America/Sao_Paulo
PORT=3000
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Append rate-limit env vars to .env</name>
  <files>.env</files>
  <action>
Append the three new environment variables to the existing `.env` file without modifying any of the existing lines. Group them together under a clear section and keep the existing MONGODB_URI, CRON_INTERVAL_*, TZ, and PORT lines byte-for-byte identical.

After this task, `.env` must contain these new lines (order: RUNS, FUP, MESSAGES) appended after the existing config:

```
RATE_LIMIT_RUNS=20
RATE_LIMIT_FUP=20
RATE_LIMIT_MESSAGES=20
```

Constraints:
- Do NOT reformat, reorder, or rewrite the existing 7 lines of `.env`.
- Do NOT add code changes, tests, or comments inside source files — this is a configuration-only change.
- Do NOT change the default of `10` in `src/dispatch/run-dispatch.service.ts` — the `.env` values will override it at runtime.
- Preserve trailing newline behaviour of the file.
  </action>
  <verify>
    <automated>grep -E '^RATE_LIMIT_(RUNS|FUP|MESSAGES)=20$' .env | wc -l | grep -q '^3$' &amp;&amp; grep -q '^MONGODB_URI=' .env &amp;&amp; grep -q '^CRON_INTERVAL_RUNS=10000$' .env &amp;&amp; grep -q '^CRON_INTERVAL_FUP=10000$' .env &amp;&amp; grep -q '^CRON_INTERVAL_MESSAGES=10000$' .env &amp;&amp; grep -q '^CRON_INTERVAL_RECOVERY=60000$' .env &amp;&amp; grep -q '^TZ=America/Sao_Paulo$' .env &amp;&amp; grep -q '^PORT=3000$' .env</automated>
  </verify>
  <done>
`.env` contains exactly three new lines `RATE_LIMIT_RUNS=20`, `RATE_LIMIT_FUP=20`, `RATE_LIMIT_MESSAGES=20`, all pre-existing config entries (MONGODB_URI, CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES, CRON_INTERVAL_RECOVERY, TZ, PORT) remain present and unchanged, and no source code files were modified.
  </done>
</task>

</tasks>

<verification>
- `.env` diff shows only additions (three new `RATE_LIMIT_*=20` lines), no deletions or modifications to existing lines.
- `git status` shows `.env` as the only modified file (no source files touched).
- On next app boot, `RunDispatchService` reads `RATE_LIMIT_RUNS`, `RATE_LIMIT_FUP`, `RATE_LIMIT_MESSAGES` as `20` (overriding the `'10'` fallback).
</verification>

<success_criteria>
- Three new env vars present in `.env` with value `20`.
- All seven pre-existing env lines preserved verbatim.
- No changes outside of `.env`.
- `pnpm run build` (if executed) succeeds — no code changes should break the build.
</success_criteria>

<output>
After completion, create `.planning/quick/260415-dah-adicionar-rate-limit-runs-20-rate-limit-/260415-dah-SUMMARY.md` documenting: the three lines appended, confirmation that no source code was modified, and the expected runtime effect (rateLimitRuns/Fup/Messages = 20 instead of default 10).
</output>
