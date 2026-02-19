import { routeTask } from "../../src/router/delegation-router.js";

const samples = [
  { intent: "write tests for parser", expected: "Tester" },
  { intent: "review this implementation", expected: "Reviewer" },
  { intent: "build and type check", expected: "BuildValidator" },
  { intent: "implement feature x", expected: "Coder" }
];

for (const sample of samples) {
  const actual = routeTask(sample.intent);
  const pass = actual === sample.expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${sample.intent} -> ${actual}`);
}
