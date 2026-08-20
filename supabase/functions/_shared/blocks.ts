/**
 * Machine-readable blocks appended to a coach reply, and how to get them back
 * out of one.
 *
 * The coach writes prose for the user and, when there is something the app can
 * act on, a fenced block after it: `<<<LOG ... LOG>>>` for meals that could be
 * added to the diary, `<<<PLAN ... PLAN>>>` for revised daily targets. The user
 * only ever sees the prose.
 *
 * Models are inconsistent about the markers. They add spaces, change case, wrap
 * the JSON in a code fence, or open a block and never close it. Every one of
 * those used to mean no card appeared and the prose stood alone — which reads
 * as though the coach did the thing itself. So parsing is forgiving, and the
 * marker text is scrubbed from the reply whether or not the block could be
 * salvaged.
 */

/**
 * Pulls one named block off a reply.
 *
 * `rest` is the prose with the block and any stray markers removed, safe to
 * show. `payload` is the raw text between the markers, or null if there was no
 * block at all.
 */
export function splitBlock(raw: string, name: string): { rest: string; payload: string | null } {
  const block = new RegExp(`<{2,}\\s*${name}\\b([\\s\\S]*?)(?:\\b${name}\\s*>{2,}|$)`, "i");
  const loose = new RegExp(`<{2,}\\s*${name}\\b|\\b${name}\\s*>{2,}`, "gi");

  const match = raw.match(block);
  const rest = (match ? raw.replace(match[0], "") : raw).replace(loose, "").trim();

  return { rest, payload: match ? match[1] : null };
}

/**
 * The JSON inside a block, when it should be a list — the meals to offer.
 *
 * Split from the object form rather than sharing one function with a shape
 * argument, because fishing an object out of a payload that is really a list
 * of objects would silently return the first meal instead of all of them.
 */
export function parseJsonArray(payload: string): unknown[] | null {
  for (const candidate of candidates(payload, /\[[\s\S]*\]/)) {
    const parsed = tryParse(candidate);
    if (Array.isArray(parsed)) return parsed;
  }
  return null;
}

/** The JSON inside a block, when it should be a single object — the plan. */
export function parseJsonObject(payload: string): Record<string, unknown> | null {
  for (const candidate of candidates(payload, /\{[\s\S]*\}/)) {
    const parsed = tryParse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * The payload as written, then unwrapped from a code fence, then fished out of
 * surrounding chatter — the two ways models deviate, in order of likelihood.
 */
function candidates(payload: string, loose: RegExp): string[] {
  const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)```/);
  return [payload, fenced?.[1], payload.match(loose)?.[0]].filter(
    (value): value is string => Boolean(value),
  );
}

function tryParse(candidate: string): unknown {
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return null;
  }
}
