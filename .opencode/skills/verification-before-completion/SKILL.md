---
name: hf-verification-before-completion
description: Use before declaring work done to ensure output matches request.
---

# Verification Before Completion

## Overview

Prevent false "done" claims by checking scope, constraints, and output quality.

## Checklist

- Verify requested scope is fully covered.
- Confirm no unrequested expansion was introduced.
- Confirm constraints from runtime-preferences are respected.
- Provide a concise summary of results and known limitations.

## Scope-fit checks

- Does behavior match user intent exactly?
- Were defaults respected (no worktrees, no auto-git, no forced tests)?
- Are changed files clearly documented?
- Are known trade-offs disclosed?

## Completion message format

- What changed
- Why it satisfies the request
- What was intentionally not done
- Optional next step suggestions
