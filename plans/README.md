# Plans

`plans/` means different things for package maintainers and consumer projects:

- In this repository, `plans/` contains generated planner outputs plus a small number of checked-in reference docs.
- In a consumer project after `hf-init`, `plans/` is scaffolded as editable project-local workflow content and is not treated as generated adapter output.

When a consumer project runs `hf-init`, this `plans/README.md` file is copied into the target project's `plans/` folder as editable project-local guidance. The generated adapter surfaces stay under `.claude/` and `.opencode/`; the `plans/` scaffold is not treated as generated mirror content.

Consumer lifecycle expectations:

- `hf-install` does not create `plans/` by default.
- `hf-init` creates `plans/`, `plans/evidence/`, and `plans/runtime/` when scaffolding is enabled.
- Re-running `hf-init` keeps existing edits and fills in only missing scaffold files.
- `hf-uninstall` removes generated adapter artifacts but keeps consumer-owned planning docs unless the project deletes them manually.

Generated plan docs belong here and should use date-prefixed filenames:

- `plans/YYYY-MM-DD-feature-name-plan.md`

Generated plan docs should follow the active plan format:

- frontmatter: `plan`, `created`, `status: in-progress|complete`
- sections: `## Overview`, `## Research Summary`, `## Milestones`, `## Risks & Open Questions`
- milestones: `- [ ] 1. Title - one-line scope + acceptance criterion`
- completed-milestone evidence: indented bullets directly under the milestone line
- final verification evidence for plan completion: record it in the same indented evidence block under the last completed milestone before setting `status: complete`

Checked-in reference docs may also live here when they describe the framework itself:

- `plans/PLAN.md` is a design/reference spec in this repo, not a generated active plan doc

Optional evidence for build or review flows can live under:

- `plans/evidence/`
- `plans/runtime/` stores runtime sidecars per plan slug and is scaffolded empty apart from a marker file when `hf-init` bootstraps a project.

Supporting artifacts may live there, but the canonical completion record still belongs in the plan doc under the relevant completed milestone.
