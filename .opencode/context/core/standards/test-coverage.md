# Test Coverage Standard

## Toggle-aware defaults

- Tests are optional unless user requests them or settings require them.
- When verification toggles are enabled, run targeted checks for changed behavior.

## Requirements

- Focus tests on changed behavior and critical regressions.
- Prefer small, deterministic tests over broad flaky suites.
- Include failure mode checks for bug fixes.

## Verification output

- Commands run
- Pass/fail status
- Known gaps and rationale
