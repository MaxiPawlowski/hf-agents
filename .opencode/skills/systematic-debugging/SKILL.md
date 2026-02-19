---
name: hf-systematic-debugging
description: Use when behavior is failing or unexpected and root cause is unclear.
---

# Systematic Debugging

## Overview

Find root cause before applying fixes. Avoid guess-fix cycles.

## Process

1. Reproduce issue reliably.
2. Narrow the failing boundary.
3. Identify root cause with evidence.
4. Apply smallest safe fix.
5. Verify behavior manually or with requested checks.

## Evidence standard

- Capture the failing symptom before changing code.
- Tie each hypothesis to an observable signal.
- Keep a short log: symptom -> hypothesis -> check -> result.

## Common failure patterns

- Hidden precondition mismatch
- Incorrect state transition ordering
- Integration contract drift
- External dependency version mismatch

## Output format

Return:
- Root cause statement
- Fix summary
- Residual risk
- Verification performed

## Project Defaults

- No automatic git operations.
- No mandatory test requirement unless requested.
