/**
 * Per-user daily AI usage limits.
 *
 * Three buckets: "chat" (text-only calls — coach messages and the dish
 * estimate), "vision" (any call that sends an image — meal photos, label scans,
 * recipe photo scans), and "verify" (the plausibility check run when a food is
 * saved to the library).
 *
 * A photo costs several times what a text call costs, so a single shared
 * counter would let a handful of photos swallow a whole day's coaching — and
 * saving a batch of foods would quietly cost someone their conversation.
 *
 * The check runs before the model is called, so a user past their limit never
 * costs the app an AI call — which is the entire point. It is refunded if the
 * model chain then fails outright, so a provider outage never eats a real day's
 * allowance.
 */

import { adminClient, userClient } from "./supabase.ts";
import { json } from "./cors.ts";

export type UsageCallType = "chat" | "vision" | "verify";

export interface UsageState {
  callType: UsageCallType;
  allowed: boolean;
  used: number;
  dailyLimit: number;
  resetsAt: string;
  /** Why a call was refused: today's cap, or too many in the last minute. */
  reason: "ok" | "daily" | "burst";
  /** Seconds until the burst window rolls over. Zero for a daily refusal. */
  retryAfter: number;
}

export class UsageLimitError extends Error {
  constructor(readonly usage: UsageState) {
    super(`${usage.callType} limit reached (${usage.reason}).`);
    this.name = "UsageLimitError";
  }
}

/**
 * Claims one call for the calling user. Throws UsageLimitError if they are
 * already at today's cap — the counter is only advanced when the call is
 * actually going to be made, so a rejected attempt is never charged.
 */
export async function tryConsumeUsage(
  client: ReturnType<typeof userClient>,
  callType: UsageCallType,
): Promise<UsageState> {
  const { data, error } = await client
    .rpc("try_increment_ai_usage", { p_call_type: callType })
    .single();

  if (error) throw new Error(`Usage check failed: ${error.message}`);

  const row = data as {
    allowed: boolean;
    used: number;
    daily_limit: number;
    resets_at: string;
    reason: "ok" | "daily" | "burst";
    retry_after: number;
  };
  const usage: UsageState = {
    callType,
    allowed: row.allowed,
    used: row.used,
    dailyLimit: row.daily_limit,
    resetsAt: row.resets_at,
    reason: row.reason ?? "ok",
    retryAfter: row.retry_after ?? 0,
  };

  if (!usage.allowed) throw new UsageLimitError(usage);
  return usage;
}

/**
 * Refunds a call that was claimed but produced nothing. Runs as the service
 * role deliberately: if the refund were callable by the browser, a user could
 * call it in a loop and zero their own counter.
 *
 * A failed refund is logged, never thrown — losing one call is a far smaller
 * problem than failing the request the user is already having trouble with.
 */
export async function releaseUsage(
  userId: string,
  callType: UsageCallType,
): Promise<void> {
  try {
    const { error } = await adminClient()
      .rpc("release_ai_usage", { p_user_id: userId, p_call_type: callType });
    if (error) console.error("[usage] refund failed", error.message);
  } catch (error) {
    // Every caller is already handling a failure of its own. A refund that
    // throws here would replace that considered answer with a blank 500.
    console.error(
      "[usage] refund threw",
      error instanceof Error ? error.message : "unknown",
    );
  }
}

/**
 * The answer the app gives when a call is refused. `noun` names what ran out,
 * in the plural: "coach messages", "photo scans".
 *
 * The two refusals read very differently to a user, so they are never phrased
 * alike. Running out for the day means come back tomorrow; going too fast means
 * wait a moment — and telling someone to come back tomorrow when they only need
 * to pause for twenty seconds would lose them for the day.
 *
 * The `usage` object travels with it so the page can update its remaining-calls
 * banner from the rejection itself, without a second round trip.
 */
export function usageLimitResponse(error: UsageLimitError, noun: string): Response {
  const { usage } = error;

  if (usage.reason === "burst") {
    return json({
      error: `That is a lot at once — give it ${usage.retryAfter} second` +
        `${usage.retryAfter === 1 ? "" : "s"} and try again.`,
      code: "rate_limit",
      usage,
    }, 429);
  }

  return json({
    error: `You have used all ${usage.dailyLimit} of today's ${noun}. ` +
      `Your allowance resets tomorrow — everything else in the app still works.`,
    code: "usage_limit",
    usage,
  }, 429);
}
