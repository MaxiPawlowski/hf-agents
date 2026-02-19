export function routeTask(intent: string): string {
  const normalized = intent.toLowerCase();

  if (
    normalized.includes("complex") ||
    normalized.includes("multi") ||
    normalized.includes("epic") ||
    normalized.includes("feature")
  ) {
    return "TaskManager";
  }

  if (normalized.includes("plan") || normalized.includes("break down")) {
    return "TaskPlanner";
  }

  if (normalized.includes("context") || normalized.includes("find")) {
    return "ContextScout";
  }

  if (normalized.includes("test") || normalized.includes("validate")) {
    return "Tester";
  }

  if (normalized.includes("review") || normalized.includes("quality")) {
    return "Reviewer";
  }

  if (normalized.includes("build") || normalized.includes("type")) {
    return "BuildValidator";
  }

  if (normalized.includes("docs") || normalized.includes("library")) {
    return "ExternalDocsScout";
  }

  if (normalized.includes("finish") || normalized.includes("pr") || normalized.includes("merge")) {
    return "Reviewer";
  }

  return "Coder";
}
