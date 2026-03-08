# Plans

`plans/` contains generated planner outputs and a small number of checked-in reference docs.

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

Supporting artifacts may live there, but the canonical completion record still belongs in the plan doc under the relevant completed milestone.
