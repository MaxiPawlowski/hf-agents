# Prompt Variants

Prompt variants let the framework tune instructions by mode or model without duplicating the full agent stack.

## Layout

- `core/core-agent/default.md`
- `core/core-agent/strict.md`
- `core/core-agent/variants.json`

## Selection Rules

1. If `--prompt-variant=<id>` is provided, use that variant when present.
2. If policy mode is `strict`, prefer `strict` variant.
3. Fallback to `default` if variant is missing.

## Validation

Run:

```bash
node scripts/validation/validate-registry.mjs
node scripts/validation/check-dependencies.mjs
```
