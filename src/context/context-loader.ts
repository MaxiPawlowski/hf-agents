export type ContextScope = "team" | "project" | "global";

export function resolveContextOrder(): ContextScope[] {
  return ["team", "project", "global"];
}

export function describeResolutionPolicy(): string {
  return "Context resolution uses team > project > global precedence.";
}
