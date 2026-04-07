# Hybrid Framework — Quality Stack

This document describes the three-layer quality enforcement stack used by the hybrid framework. Each layer addresses a different point in the development lifecycle: prompt guidance shapes code at generation time, Oxlint enforces structural rules at edit and commit time, and ESLint with sonarjs catches cognitive-complexity issues, duplication patterns, and code smells that structural linting cannot see. Together the three layers form a graduated, redundant quality pipeline that catches problems as early as possible — before they reach a reviewer or a permanent record in the plan doc.

---

## Table of Contents

- [Layer 1 — Prompt Guidance](#layer-1--prompt-guidance)
- [Layer 2 — Oxlint](#layer-2--oxlint)
- [Layer 3 — ESLint + SonarJS](#layer-3--eslint--sonarjs)
- [Config Protection Guardrail](#config-protection-guardrail)
- [npm Scripts Reference](#npm-scripts-reference)
- [Windows / Git Bash Note](#windows--git-bash-note)

---

## Layer 1 — Prompt Guidance

The first enforcement layer operates before any linter or scanner runs. Every agent that generates or modifies code receives explicit code-shape constraints injected directly into its system prompt. Encoding the rules at generation time means that violations are avoided rather than discovered after the fact, reducing the number of lint–fix–retry cycles required to close a milestone.

The active code-shape constraints are:

- Function length ≤ 50 lines
- File length ≤ 500 lines
- Maximum 3 parameters per function (use an options object when more are needed)
- Maximum nesting depth of 3 levels (flatten with early returns or extracted helpers)
- No `any` type — use explicit types, generics, or `unknown` with a narrowing guard
- No magic numbers — extract non-trivial literals into named constants
- Consistent `import type` for type-only imports
- Every `Promise` must be awaited, returned, or explicitly handled with `.catch`

These constraints mirror the active rules in [`.oxlintrc.json`](../.oxlintrc.json) so that prompt guidance and the linter enforce exactly the same surface.

### Agent Inner-Loop Pipeline

Agents follow a mandatory quality pipeline after each implementation pass:

1. **Auto-fix pass** — the Coder runs `npx oxlint --fix <touched files>` to apply all automatically fixable violations before review.
2. **Type check** — the Coder runs `npx tsc --noEmit` to confirm no type errors were introduced by the changes.
3. **Manual fix loop** — if violations remain after the `--fix` pass, the Coder attempts manual fixes. The maximum is 3 attempts per file; if violations persist after 3 attempts they are reported explicitly as `gaps` in the turn outcome and execution continues without suppression directives.
4. **Builder strict check** — before dispatching the reviewer, the Builder runs `npx oxlint <touched files>` (without `--fix`) to validate the final state of every touched file.
5. **Reviewer gate** — the Reviewer treats any remaining Oxlint-detectable structural violation as a blocking quality failure and returns a `blocked` turn outcome.

---

## Layer 2 — Oxlint

Oxlint is the primary structural linter. It enforces the same code-shape constraints described in Layer 1, running at multiple points: during the agent inner-loop, in pre-commit hooks, and optionally in editor sessions via the VS Code extension.

Config file: [`.oxlintrc.json`](../.oxlintrc.json) at the repo root.

### Rule Categories

The active ruleset covers the following concern areas:

- **Function size and complexity** — flags functions that exceed 50 lines and excessive cyclomatic complexity
- **File size** — flags files that exceed 500 lines, keeping modules focused and navigable
- **Magic values** — requires named constants for non-trivial literals to preserve intent at the call site
- **Dead code** — warns on unreachable branches and unused declarations
- **TypeScript strictness** — bans `any`, requires explicit return types, enforces `import type` for type-only imports
- **Import hygiene** — enforces consistent import ordering and disallows wildcard re-exports that obscure the public surface
- **Promise handling** — requires every `Promise` to be awaited, returned, or `.catch`-handled; fire-and-forget patterns are flagged
- **Modern JS patterns** — prefers `const`, arrow functions, and optional chaining over equivalent legacy patterns

### Test and Config File Overrides

Several rule relaxations apply to non-production files. The overrides in `.oxlintrc.json` cover:

- `**/*.test.ts` and `**/*.spec.ts` — magic-number and function-length rules are relaxed to allow the inline data and setup blocks common in test suites
- `**/*.config.ts` — import-hygiene rules are relaxed to allow the default-export patterns required by configuration entrypoints
- `src/bin/**` — file-length and complexity rules are relaxed for CLI entrypoint scripts that necessarily aggregate setup logic

### Escape Prevention

Two policies prevent agents from silently escaping quality enforcement:

**Config edit guard.** The runtime guardrail (`src/adapters/lifecycle.ts: isProtectedConfigEdit()`) blocks agent edits to `.oxlintrc.json`. This prevents an agent from weakening rules to make lint pass. To make an intentional, reviewed change to the Oxlint configuration, set the `HF_ALLOW_CONFIG_EDIT=1` environment variable before running the agent.

**Suppression directive policy.** New `oxlint-disable` or `oxlint-ignore` directives require both a written justification comment in the source file explaining why the rule does not apply at that location, and explicit milestone scope approval from the plan doc or invoking builder. Adding a suppression directive solely to make lint pass is a scope violation.

### Running Oxlint

```sh
# Strict check — exits non-zero on any error, suitable for CI and pre-dispatch validation
npm run lint

# Auto-fix pass — applies trivial violations automatically
npm run lint:fix

# Target a specific file during implementation
npx oxlint src/adapters/lifecycle.ts
npx oxlint --fix src/adapters/lifecycle.ts
```

### Pre-Commit Hook

The [`.husky/pre-commit`](../.husky/pre-commit) hook runs `lint-staged`, which calls `npx oxlint` on every staged `*.ts` file before the commit is recorded. This means Oxlint runs automatically on the exact files being committed, not on the entire repo, keeping pre-commit times short.

### VS Code Editor Integration

For real-time feedback during editing, install the `oxc.oxc-vscode` extension. It is listed as a recommended extension in [`.vscode/extensions.json`](../.vscode/extensions.json) and provides inline LSP diagnostics using the same rule configuration as the CLI. This surfaces violations as you type rather than at lint or commit time.

---

## Layer 3 — ESLint + SonarJS

ESLint with `eslint-plugin-sonarjs` and `typescript-eslint` covers the quality signals that Oxlint cannot produce: cognitive complexity, code smell patterns, copy-paste detection, redundant boolean logic, and type-aware checks that require the full TypeScript type graph.

Config file: [`eslint.config.js`](../eslint.config.js) at the repo root.

ESLint runs after Oxlint in both the `npm run lint` script and the pre-commit hook via lint-staged. Because Oxlint handles the fast structural checks, ESLint focuses on the higher-level semantic rules.

### Active Rule Categories

- **SonarJS code smells** — cognitive complexity ≤ 10, no duplicate strings, no redundant booleans, no collapsible ifs, no immediately-returned variables, prefer single boolean return
- **SonarJS copy-paste detection** — flags identical function bodies within a file
- **Type-aware TypeScript** — no unnecessary type assertions, no unnecessary conditions, prefer nullish coalescing and optional chaining, no redundant type constituents
- **Core ESLint** — object shorthand, template literals, destructuring, no useless returns

### Running ESLint

```sh
# Full lint suite (oxlint + eslint)
npm run lint

# Auto-fix pass
npm run lint:fix

# ESLint only — useful for diagnosing sonarjs or type-aware violations
npx eslint src/ tests/ scripts/
```

---

## Config Protection Guardrail

The runtime guardrail in `src/adapters/lifecycle.ts` — specifically the `isProtectedConfigEdit()` function — intercepts agent tool calls that would modify quality configuration files and rejects them unless the override variable is set.

Protected files:
- `.oxlintrc.json`
- `.husky/pre-commit`

The protected file list is stored in the `PROTECTED_CONFIG_FILES` constant in [`src/adapters/lifecycle.ts`](../src/adapters/lifecycle.ts). The guard is wired into both the Claude adapter (PreToolUse hook) and the OpenCode adapter (tool.execute.before hook), so it applies regardless of which platform the agent is running on.

To make an intentional, reviewed change to one of these files, set `HF_ALLOW_CONFIG_EDIT=1` in the environment before starting the agent session:

```sh
HF_ALLOW_CONFIG_EDIT=1 npx opencode
```

Any change made under this override should be reviewed in the plan doc or a pull request with a clear rationale, because weakening lint or pre-commit rules affects all subsequent agent sessions.

---

## npm Scripts Reference

| Script | Command | Purpose |
|---|---|---|
| `npm run lint` | `npx oxlint … && npx eslint …` | Strict check — exits non-zero on errors |
| `npm run lint:fix` | `npx oxlint --fix … && npx eslint --fix …` | Auto-fix trivial violations |
| `npm run precommit` | `npm run lint` | Manual pre-commit check |

Run `npm run precommit` before committing when Husky hooks are not firing — for example, when committing from a GUI client or a terminal that does not source the Git Bash environment.

---

## Windows / Git Bash Note

Husky v9+ requires Git Bash or WSL to execute shell scripts on Windows. If you commit from CMD or a bare PowerShell session, the pre-commit hook may silently not fire, meaning Oxlint does not run and violations can reach the repository.

To ensure hooks run reliably on Windows, configure your terminal emulator (VS Code integrated terminal, Windows Terminal, or similar) to use Git Bash as its default shell. Alternatively, run `npm run precommit` manually before every commit as a belt-and-suspenders check.

If you use the VS Code integrated terminal and the default shell is PowerShell, open the command palette and set **Terminal: Select Default Profile** to **Git Bash**. New terminal tabs will then use Git Bash and Husky hooks will fire correctly.
