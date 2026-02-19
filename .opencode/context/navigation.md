# Context Navigation

Use this file to quickly route context loading.

## Quick routes

- Code work: `@.opencode/context/core/standards/code-quality.md`
- Test work: `@.opencode/context/core/standards/test-coverage.md`
- Documentation work: `@.opencode/context/core/standards/documentation.md`
- Project patterns: `@.opencode/context/project-intelligence/technical-domain.md`
- External inspiration profile: `@.opencode/context/project-intelligence/external-inspirations.md`
- Runtime behavior defaults: `@.opencode/context/project/runtime-preferences.md`
- Canonical runtime policy: `@.opencode/context/project/policy-contract.md`
- Verification schema: `@.opencode/context/project/verification-evidence-schema.md`
- Subagent handoff bundle: `@.opencode/context/project/subagent-handoff-template.md`

## Loading guidance

- Load only the minimal files needed for the active task.
- For cross-cutting tasks, load both standards and project-intelligence patterns.
- Keep context under 200 lines per file where possible.
- Prefer MVI loading: only files needed for the current step.
