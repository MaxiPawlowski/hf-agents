# Claude E2E Contract

The Claude e2e suite is intentionally split into three evidence layers:

| Layer | File / helper | What a passing check proves | Prerequisites / skip conditions |
|---|---|---|---|
| Hook-binary diagnostics | `tests/e2e/helpers/claude-harness.ts` via `runClaudeHook(...)`; invocation-path coverage in `tests/e2e/runtime-claude-e2e.test.ts` | The Claude hook wrapper and selected CLI invocation shapes still honor project hook settings and produce expected hook-side effects. This does **not** by itself prove full end-to-end runtime parity. | Claude CLI diagnostics require the CLI to be installed and authenticated; direct hook invocation is lower-level diagnostic coverage only. |
| Fast real-generation runtime parity | `tests/e2e/runtime-claude-e2e.test.ts` | A real authenticated `claude -p` run produced a final response and wrote planless runtime artifacts (`plans/runtime/_planless/events.jsonl`, related sidecars). This is the fast Claude parity boundary for runtime-sidecar coverage. | Skips when the Claude CLI is unavailable or not logged in with `claude login`. |
| Slow managed-plan / vault parity | `tests/e2e/vault-claude-e2e.test.ts` | A real authenticated Claude run exercised the managed-plan/vault path and produced stable adapter-facing managed sidecars (`events.jsonl`, `resume-prompt.txt`, `status.json`) in addition to model output. | Requires `HF_RUN_SLOW=1` and authenticated Claude access; otherwise the file skips intentionally. |

Do not treat a green fast Claude runtime run as proof of managed-plan or vault parity. Managed-plan/vault confidence comes from the slow Claude file, while direct hook helpers remain diagnostic support rather than the primary parity claim.
