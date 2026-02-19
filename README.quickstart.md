# Quickstart

Use this when you want to start fast.

## 1) Install and build

```bash
npm install
npm run build
```

## 2) Run baseline checks

```bash
npm run validate:assets
npm test
```

## 3) Verify runtime profile

```bash
node dist/cli/index.js doctor
```

## 4) Try core CLI flow

```bash
framework agents
framework skills
framework run --intent "implement feature" --mode fast
```

## 5) Use command contracts

Command definitions are in `.opencode/commands/`.

Recommended flow:
1. `setup`
2. `plan-feature`
3. `run-core-delegation`
4. `verify`
5. `finish`

## 6) Safe install/update of `.opencode` assets

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --dry-run
```

Collision policies:
- `skip`
- `overwrite`
- `backup`
- `cancel`

## 7) Token usage harness

```bash
npm run eval:transcript
```

## Where to look next

- Full project overview: `README.md`
- Architecture and contracts: `docs/architecture.md`, `docs/architecture-contracts.md`
- Install and validation ops: `docs/install-and-validation.md`
- Portability notes: `docs/portability-matrix.md`
