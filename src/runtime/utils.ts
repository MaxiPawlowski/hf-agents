export function isRecord(value: unknown): value is Record<string, unknown> {
  // eslint-disable-next-line no-restricted-syntax -- isRecord is itself a primitive type guard; typeof is unavoidable here
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// eslint-disable-next-line no-restricted-syntax -- isString is itself a primitive type guard; typeof is unavoidable here
export function isString(v: unknown): v is string { return typeof v === "string"; }
// eslint-disable-next-line no-restricted-syntax -- isNumber is itself a primitive type guard; typeof is unavoidable here
export function isNumber(v: unknown): v is number { return typeof v === "number" && !Number.isNaN(v); }
// eslint-disable-next-line no-restricted-syntax -- isBoolean is itself a primitive type guard; typeof is unavoidable here
export function isBoolean(v: unknown): v is boolean { return typeof v === "boolean"; }

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onDeadline: () => T | Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      // void: the promise resolves/rejects the outer `deadline` promise via .then(resolve, reject).
      // The chain is intentionally not returned since we're inside a setTimeout callback.
      void Promise.resolve()
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
