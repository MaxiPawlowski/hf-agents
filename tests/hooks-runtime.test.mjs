import test from "node:test";
import assert from "node:assert/strict";

import { runHookRuntime } from "../dist/src/hooks/runtime.js";

test("hook runtime supports disabling all hooks", () => {
  const result = runHookRuntime({
    stage: "before_output",
    output: "hello",
    notes: [],
    hookConfig: {
      enabled: false,
      hooks: {}
    }
  });

  assert.equal(result.output, "hello");
  assert.deepEqual(result.notes, []);
  assert.equal(result.truncated, false);
});

test("hook runtime supports per-hook output truncation config", () => {
  const result = runHookRuntime({
    stage: "before_output",
    output: "abcdefghijklmnopqrstuvwxyz",
    notes: [],
    hookConfig: {
      enabled: true,
      hooks: {
        "output-truncation-guard": {
          enabled: true,
          maxOutputChars: 10
        },
        "context-injection-note": {
          enabled: false
        },
        "completion-continuation-reminder": {
          enabled: false
        }
      }
    }
  });

  assert.match(result.output, /^abcdefghij/);
  assert.ok(result.notes.some((note) => note.includes("Output truncated to 10 characters")));
  assert.equal(result.truncated, true);
});
