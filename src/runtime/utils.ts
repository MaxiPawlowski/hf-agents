export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onDeadline: () => T | Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      Promise.resolve()
        .then(onDeadline)
        .then(resolve, reject);
    }, ms);
  });

  return Promise.race([promise, deadline]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
