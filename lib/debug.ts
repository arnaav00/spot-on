type Details = Record<string, unknown>;

const prefix = (event: string) => `[Spot On ${new Date().toISOString()}] ${event}`;

export function logEvent(event: string, details: Details = {}) {
  console.info(prefix(event), details);
}

export function logWarn(event: string, details: Details = {}) {
  console.warn(prefix(event), details);
}

export function logError(event: string, error: unknown, details: Details = {}) {
  console.error(prefix(event), {
    ...details,
    error: error instanceof Error ? error.message : String(error),
  });
}

export const shortId = (value: string | null | undefined) => value ? value.slice(0, 8) : null;
