# Command-Agent Transcript Eval Harness

This harness parses session transcript lines and reports token usage by actor (main session and subagents).

## Run

```bash
node evals/command-agent/transcript-token-harness.mjs --fixture evals/command-agent/fixtures/sample-run.jsonl
```

## Output

- total event count
- per-actor token usage
  - input tokens
  - output tokens
  - cache read/write tokens

## Notes

- The parser accepts JSONL lines.
- Unknown fields are ignored.
- Use this as a lightweight regression signal for orchestration token drift.
