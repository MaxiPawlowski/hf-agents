# Toggle Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 4 legacy toggles (`use_worktree`, `require_tests`, `require_verification`, `task_artifacts`) with 2 focused toggles (`deep_plan`, `enable_review`) across the full stack: TypeScript contracts → runtime settings → skill engine → plugin layer → command files → context docs.

**Architecture:** The toggle system spans two layers — a TypeScript layer (`src/`) that defines the `RuntimeToggles` type and resolves settings, and a plugin layer (`.opencode/plugins/lib/`) that persists/reads state from `settings/framework-settings.json`. Both must be updated in sync. Command files in `.opencode/commands/` are markdown definitions for slash commands; the plugin's `command.execute.before` hook reads `COMMAND_TOGGLE_MAP` from `config.js` to handle them at runtime.

**Tech Stack:** TypeScript + Zod (contracts/settings), plain ESM JS (plugin layer), Markdown (command files + context docs). Build: `npm run build`. Validation: `npm run validate:assets`.

---

### Task 1: Update `src/contracts/index.ts` — replace runtimeTogglesSchema

**Files:**
- Modify: `src/contracts/index.ts:44-52`

**Step 1: Replace `runtimeTogglesSchema` fields**

Find and replace these lines (44–52):
```typescript
export const runtimeTogglesSchema = z.object({
  useWorktreesByDefault: z.boolean().default(false),
  manageGitByDefault: z.boolean().default(false),
  requireTests: z.boolean().default(false),
  requireApprovalGates: z.boolean().default(false),
  requireVerification: z.boolean().default(false),
  requireCodeReview: z.boolean().default(false),
  enableTaskArtifacts: z.boolean().default(false)
});
```

With:
```typescript
export const runtimeTogglesSchema = z.object({
  deepPlan: z.boolean().default(false),
  enableReview: z.boolean().default(false)
});
```

`runtimeTogglesOverridesSchema` on line 54 is `runtimeTogglesSchema.partial()` — no change needed there.

**Step 2: Build to verify no type errors yet**

Run: `npm run build`
Expected: TypeScript errors in `runtime-settings.ts` and `skill-engine.ts` (they still reference old keys) — that's expected, fixes come in Tasks 2–3.

**Step 3: Commit**

```bash
git add src/contracts/index.ts
git commit -m "refactor: replace runtimeTogglesSchema with deepPlan + enableReview"
```

---

### Task 2: Update `src/settings/runtime-settings.ts` — update defaults and legacy guard

**Files:**
- Modify: `src/settings/runtime-settings.ts:24-57`

**Step 1: Replace `BASE_RUNTIME_SETTINGS.toggles`**

Find (lines 27–34):
```typescript
  toggles: {
    useWorktreesByDefault: false,
    manageGitByDefault: false,
    requireTests: false,
    requireApprovalGates: false,
    requireVerification: false,
    requireCodeReview: false,
    enableTaskArtifacts: false
  },
```

Replace with:
```typescript
  toggles: {
    deepPlan: false,
    enableReview: false
  },
```

**Step 2: Replace `legacyToggleKeys`**

Find (lines 65–73):
```typescript
  const legacyToggleKeys = [
    "useWorktreesByDefault",
    "manageGitByDefault",
    "requireTests",
    "requireApprovalGates",
    "requireVerification",
    "requireCodeReview",
    "enableTaskArtifacts"
  ];
```

Replace with:
```typescript
  const legacyToggleKeys = [
    "useWorktreesByDefault",
    "manageGitByDefault",
    "requireTests",
    "requireApprovalGates",
    "requireVerification",
    "requireCodeReview",
    "enableTaskArtifacts",
    "deepPlan",
    "enableReview"
  ];
```

> Note: The old keys are kept in the guard because someone might still have them at the top level of `framework-settings.json` (not nested under `toggles`). The new keys are added for the same reason — they must be nested.

**Step 3: Build to verify**

Run: `npm run build`
Expected: `runtime-settings.ts` errors gone. Remaining errors only in `skill-engine.ts`.

**Step 4: Commit**

```bash
git add src/settings/runtime-settings.ts
git commit -m "refactor: update BASE_RUNTIME_SETTINGS toggles and legacyToggleKeys"
```

---

### Task 3: Update `src/skills/skill-engine.ts` — replace toggle-gated skill logic

**Files:**
- Modify: `src/skills/skill-engine.ts`

**Step 1: Replace `skillsForEnabledToggles`**

Find (lines 101–119):
```typescript
export function skillsForEnabledToggles(toggles: RuntimeToggles): string[] {
  const enabled: string[] = [];
  if (toggles.useWorktreesByDefault || toggles.manageGitByDefault) {
    enabled.push("hf-git-workflows");
  }
  if (toggles.requireTests) {
    enabled.push("hf-testing-gate");
  }
  if (toggles.requireApprovalGates || toggles.requireVerification || toggles.requireCodeReview) {
    enabled.push("hf-approval-gates");
  }
  if (toggles.enableTaskArtifacts) {
    enabled.push("hf-task-artifact-gate");
  }
  if (toggles.requireVerification) {
    enabled.push("hf-verification-before-completion");
  }
  return enabled;
}
```

Replace with:
```typescript
export function skillsForEnabledToggles(toggles: RuntimeToggles): string[] {
  const enabled: string[] = [];
  if (toggles.deepPlan) {
    enabled.push("hf-web-research-scout", "hf-brainstormer", "hf-code-search-scout", "hf-plan-synthesis");
  }
  if (toggles.enableReview) {
    enabled.push("hf-verification-before-completion", "hf-reviewer");
  }
  return enabled;
}
```

**Step 2: Update `CORE_SKILLS` — retire 4 old entries, add 4 new ones**

Find and remove these 4 entries from `CORE_SKILLS`:
```typescript
  {
    id: "hf-git-workflows",
    triggerHints: ["git workflow", "worktree", "branching"]
  },
  {
    id: "hf-testing-gate",
    triggerHints: ["test gate", "test required", "coverage gate"]
  },
  {
    id: "hf-approval-gates",
    triggerHints: ["approval gate", "verification gate", "review gate"]
  },
  {
    id: "hf-task-artifact-gate",
    triggerHints: ["task artifact", "task bundle", "lifecycle artifacts"]
  }
```

Add these 4 entries at the end of `CORE_SKILLS` (before the closing `]`):
```typescript
  {
    id: "hf-local-context-scout",
    triggerHints: ["local context", "read files", "project scan"]
  },
  {
    id: "hf-web-research-scout",
    triggerHints: ["web research", "online search", "external knowledge"]
  },
  {
    id: "hf-code-search-scout",
    triggerHints: ["code search", "github search", "online code"]
  },
  {
    id: "hf-reviewer",
    triggerHints: ["review", "reviewer", "code review", "sign off"]
  }
```

**Step 3: Build to verify — no errors expected**

Run: `npm run build`
Expected: Clean build, zero errors.

**Step 4: Commit**

```bash
git add src/skills/skill-engine.ts
git commit -m "refactor: update skillsForEnabledToggles and CORE_SKILLS for new toggle set"
```

---

### Task 4: Update `.opencode/plugins/lib/config.js` — replace all 5 constants

**Files:**
- Modify: `.opencode/plugins/lib/config.js:12-50`

**Step 1: Replace all 5 exports**

Replace lines 12–50 entirely with:
```javascript
export const TOGGLE_KEYS = [
  "deep_plan",
  "enable_review",
];

export const COMMAND_TOGGLE_MAP = {
  "toggle-plan": "deep_plan",
  "toggle-review": "enable_review",
};

export const TOGGLE_COMMAND_FILE_BY_KEY = {
  deep_plan: "toggle-plan.md",
  enable_review: "toggle-review.md",
};

export const TOGGLE_RULE_TEXT = {
  deep_plan: "Run web research, brainstorming, online code search, and plan synthesis during planning phase.",
  enable_review: "Run verification and reviewer agent at the end of the build flow.",
};

export const SETTINGS_TOGGLE_KEYS = {
  deep_plan: ["deepPlan"],
  enable_review: ["enableReview"],
};
```

**Step 2: Verify no syntax errors**

Run: `node --input-type=module < .opencode/plugins/lib/config.js`
Expected: No output (no errors).

**Step 3: Commit**

```bash
git add .opencode/plugins/lib/config.js
git commit -m "refactor: update config.js for deep_plan + enable_review toggles"
```

---

### Task 5: Update `.opencode/plugins/lib/state.js` — replace defaults and file reader

**Files:**
- Modify: `.opencode/plugins/lib/state.js:37-57`

**Step 1: Replace `defaultToggles`**

Find (lines 37–42):
```javascript
const defaultToggles = () => ({
  use_worktree: false,
  require_tests: false,
  require_verification: false,
  task_artifacts: false,
});
```

Replace with:
```javascript
const defaultToggles = () => ({
  deep_plan: false,
  enable_review: false,
});
```

**Step 2: Replace `fromSettingsFile` toggle mapping**

Find (lines 49–54):
```javascript
  toggles.use_worktree = Boolean(source.useWorktreesByDefault || source.manageGitByDefault);
  toggles.require_tests = Boolean(source.requireTests);
  toggles.require_verification = Boolean(
    source.requireApprovalGates || source.requireVerification || source.requireCodeReview,
  );
  toggles.task_artifacts = Boolean(source.enableTaskArtifacts);
```

Replace with:
```javascript
  toggles.deep_plan = Boolean(source.deepPlan);
  toggles.enable_review = Boolean(source.enableReview);
```

**Step 3: Verify no syntax errors**

Run: `node --input-type=module --eval "import('./opencode/plugins/lib/state.js').then(() => console.log('ok'))"`

Wait — this file uses `fs` and `path` which will run fine. Just check syntax:
Run: `node --check .opencode/plugins/lib/state.js`
Expected: No output (no syntax errors).

**Step 4: Commit**

```bash
git add .opencode/plugins/lib/state.js
git commit -m "refactor: update state.js defaults and reader for deep_plan + enable_review"
```

---

### Task 6: Create `.opencode/commands/toggle-plan.md`

**Files:**
- Create: `.opencode/commands/toggle-plan.md`

**Step 1: Write the command file**

```markdown
---
name: toggle-plan
description: "HF: OFF - Toggle deep plan on or off."
argument-hint: <on|off>
---
## Purpose

Set `deep_plan` runtime toggle. When ON, activates web research scout, brainstormer, online code search, and plan synthesis during the planning phase.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=deep_plan`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `deep_plan=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.
```

**Step 2: Run contract linter**

Run: `npm run validate:command-contracts`
Expected: `toggle-plan.md` passes (no findings).

**Step 3: Commit**

```bash
git add .opencode/commands/toggle-plan.md
git commit -m "feat: add toggle-plan command"
```

---

### Task 7: Create `.opencode/commands/toggle-review.md`

**Files:**
- Create: `.opencode/commands/toggle-review.md`

**Step 1: Write the command file**

```markdown
---
name: toggle-review
description: "HF: OFF - Toggle enable review on or off."
argument-hint: <on|off>
---
## Purpose

Set `enable_review` runtime toggle. When ON, activates verification-before-completion and the reviewer agent at the end of the build flow.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=enable_review`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `enable_review=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.
```

**Step 2: Run contract linter**

Run: `npm run validate:command-contracts`
Expected: Both new command files pass.

**Step 3: Commit**

```bash
git add .opencode/commands/toggle-review.md
git commit -m "feat: add toggle-review command"
```

---

### Task 8: Delete 4 retired command files

**Files:**
- Delete: `.opencode/commands/toggle-worktree.md`
- Delete: `.opencode/commands/toggle-tests.md`
- Delete: `.opencode/commands/toggle-verification.md`
- Delete: `.opencode/commands/toggle-artifacts.md`

**Step 1: Delete the files**

```bash
git rm .opencode/commands/toggle-worktree.md \
       .opencode/commands/toggle-tests.md \
       .opencode/commands/toggle-verification.md \
       .opencode/commands/toggle-artifacts.md
```

**Step 2: Run contract linter to confirm no dangling refs**

Run: `npm run validate:command-contracts`
Expected: Passes. (No command file references these by name.)

**Step 3: Commit**

```bash
git commit -m "remove: retire toggle-worktree, toggle-tests, toggle-verification, toggle-artifacts commands"
```

---

### Task 9: Update `.opencode/context/project/runtime-preferences.md`

**Files:**
- Modify: `.opencode/context/project/runtime-preferences.md`

**Step 1: Replace the non-negotiable defaults section**

Find (lines 12–17):
```markdown
- Do not use worktrees unless explicitly requested by the user.
- Do not manage git unless explicitly requested by the user.
- Do not force test execution; manual validation is the default.
- Do not use approval-gate blocking as default workflow.
```

Replace with:
```markdown
- Do not run web research or brainstorming scouts unless `deep_plan` is ON.
- Do not run the reviewer agent unless `enable_review` is ON.
- Local code search (`hf-local-context-scout`) always runs during planning.
- Verification before completion always runs when `enable_review` is ON.
```

**Step 2: Replace the `Current keys:` line**

Find:
```markdown
  - `useWorktreesByDefault`, `manageGitByDefault`, `requireTests`, `requireApprovalGates`, `requireVerification`, `requireCodeReview`, `enableTaskArtifacts`
```

Replace with:
```markdown
  - `deepPlan`, `enableReview`
```

**Step 3: Replace the 4 toggle-gated skill lines**

Find (lines 51–54):
```markdown
{{#if toggle.use_worktree}}- Load `hf-git-workflows` when making workspace/git strategy decisions.{{/if}}
{{#if toggle.require_tests}}- Load `hf-testing-gate` / `hf-tester` when shipping code changes.{{/if}}
{{#if toggle.require_verification}}- Load `hf-approval-gates` + `hf-verification-before-completion` when making readiness/completion decisions.{{/if}}
{{#if toggle.task_artifacts}}- Load `hf-task-artifact-gate` / `hf-task-management` when work spans multiple steps or delegated units.{{/if}}
```

Replace with:
```markdown
{{#if toggle.deep_plan}}- Load `hf-web-research-scout`, `hf-brainstormer`, `hf-code-search-scout`, `hf-plan-synthesis` during the planning phase.{{/if}}
{{#if toggle.enable_review}}- Load `hf-verification-before-completion` + `hf-reviewer` at the end of the build flow.{{/if}}
```

**Step 4: Replace the "Optional task loop (v2)" section**

Find (lines 56–60):
```markdown
## Optional task loop (v2)

- Task lifecycle tracking automation is optional by default.
- Lifecycle artifacts in `.tmp/task-lifecycle.json` are required when task artifacts are required; `hf-task-loop` is the recommended helper.
```

Replace with:
```markdown
## Always-on skills

- `hf-local-context-scout` always loads during planning — it is not toggled.
- `hf-verification-before-completion` loads when `enable_review` is ON, not independently.
```

**Step 5: Run context-refs validator**

Run: `npm run validate:context-refs`
Expected: Passes.

**Step 6: Commit**

```bash
git add .opencode/context/project/runtime-preferences.md
git commit -m "docs: update runtime-preferences for 2-toggle design"
```

---

### Task 10: Migrate `settings/framework-settings.json`

**Files:**
- Modify: `settings/framework-settings.json`

**Step 1: Replace old toggle keys with new ones**

Current file has (under `"toggles"`):
```json
{
  "useWorktreesByDefault": true,
  "manageGitByDefault": true,
  "requireTests": false,
  "requireApprovalGates": true,
  "requireVerification": true,
  "requireCodeReview": true,
  "enableTaskArtifacts": true
}
```

Replace with:
```json
{
  "deepPlan": false,
  "enableReview": true
}
```

Migration rationale:
- `deepPlan`: defaults `false` (new capability, opt-in)
- `enableReview`: `true` because `requireApprovalGates`, `requireVerification`, and `requireCodeReview` were all `true`

**Step 2: Verify the file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('settings/framework-settings.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 3: Commit**

```bash
git add settings/framework-settings.json
git commit -m "chore: migrate framework-settings.json to new toggle keys"
```

---

### Task 11: Full build + validate

**Step 1: Clean build**

Run: `npm run build`
Expected: Zero errors, zero warnings.

**Step 2: Full asset validation**

Run: `npm run validate:assets`
Expected: All validators pass (registry, deps, context-refs, command-contracts, agent-contracts, skill-contracts).

**Step 3: Commit if any auto-fixes were needed, otherwise done**

```bash
git status
# If clean:
echo "All good — no further changes needed."
```
