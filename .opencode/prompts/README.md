# Prompt Assets

Core behavior is defined in agent markdown plus runtime toggles.

Runtime behavior is toggle-first: use resolved `settings.toggles.*` for execution gates.

## Layout

- Prompt assets are optional and can be added per project.

## Validation

Run:

```bash
node scripts/validation/validate-registry.mjs
node scripts/validation/check-dependencies.mjs
```
