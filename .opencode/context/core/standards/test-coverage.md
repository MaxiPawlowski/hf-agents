# Test Coverage Standard

## Profile-aware defaults

- fast: tests optional unless user asks.
- balanced: run targeted verification for changed behavior.
- strict: tests required before completion.

## Requirements

- Focus tests on changed behavior and critical regressions.
- Prefer small, deterministic tests over broad flaky suites.
- Include failure mode checks for bug fixes.

## Verification output

- Commands run
- Pass/fail status
- Known gaps and rationale
