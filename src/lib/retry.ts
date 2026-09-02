import { isTransient } from "./errors";

/**
 * Trying again, but only where trying again is safe and could help.
 *
 * Two rules do all the work here, and both are about restraint:
 *
 *   1. Only transient failures are retried. A dropped connection deserves
 *      another go; a rejected token or a row RLS forbids will fail identically
 *      forever, and retrying it just makes the user wait longer for the same
 *      answer while hammering a server that already said no.
 *
 *   2. Reads only, by design. There is no `withRetry` around logging a food,
 *      because a request that timed out may still have been applied at the
 *      other end — and a diary with the same meal in it twice is a worse
 *      outcome than an error the user can act on. Anything that writes needs
 *      idempotency at the database before it can be retried safely, and this
 *      app does not have that yet.
 */

const DEFAULT_ATTEMPTS = 3;
/** First backoff. Doubles each time, so 250ms then 500ms. */
const BASE_DELAY_MS = 250;
/**
 * Up to this much random extra per wait. Without it every client that dropped
 * out during the same blip comes back at the same instant and knocks the
 * service over again.
 */
const JITTER_MS = 120;

export interface RetryOptions {
  /** Total tries, not extra tries. 3 means the original plus two more. */
  attempts?: number;
  /** Overrides which failures are considered worth another go. */
  shouldRetry?: (reason: unknown) => boolean;
}

export async function withRetry<T>(
  run: () => Promise<T>,
  { attempts = DEFAULT_ATTEMPTS, shouldRetry = isTransient }: RetryOptions = {},
): Promise<T> {
  let lastReason: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (reason) {
      lastReason = reason;

      // A settled answer, or the last go. Either way the caller gets the real
      // error rather than a generic one — it is what the message shown to the
      // user is built from.
      if (!shouldRetry(reason) || attempt === attempts - 1) throw reason;

      await wait(BASE_DELAY_MS * 2 ** attempt + Math.random() * JITTER_MS);
    }
  }

  throw lastReason;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
