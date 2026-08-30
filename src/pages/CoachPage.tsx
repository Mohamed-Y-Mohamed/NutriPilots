import { Bot, Camera, Check, Images, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Alert,
  Button,
  cx,
  IconButton,
  inputClass,
  Skeleton,
  useTypewriter,
} from "../components/ui";
import { IngredientLines } from "../components/IngredientLines";
import { PlanCard } from "../components/PlanCard";
import { ScrollingText } from "../components/ScrollingText";
import { formatTimeUntil } from "../lib/dates";
import { round1, totalsForLines } from "../lib/nutrition";
import { prepareImage } from "../lib/image";
import { capturePhoto, isNative } from "../lib/native";
import {
  clearChatHistory,
  FunctionError,
  getAiUsage,
  loadChatHistory,
  markEstimateLogged,
  sendChatMessage,
  uploadMealPhoto,
} from "../services/aiClient";
import { useAppData } from "../state/AppDataContext";
import { useAuth } from "../state/AuthContext";
import {
  MEALS,
  type ChatMessage,
  type CoachPlan,
  type MealEstimate,
  type MealName,
  type MealSuggestion,
  type EstimateLine,
  type UsageState,
} from "../types";

import { presentError } from "../lib/errors";

/** Today's remaining calls, per bucket. Null until the first read lands. */
interface UsageAllowance {
  chat: UsageState | null;
  vision: UsageState | null;
}

/** Replaces just the bucket the server reported on, leaving the other alone. */
function withUsage(usage: UsageState) {
  return (current: UsageAllowance): UsageAllowance => ({
    ...current,
    [usage.callType]: usage,
  });
}

/**
 * A refusal that is about timing rather than anything being broken.
 *
 * Held in state so the composer can stand itself down for as long as it lasts.
 * Before this existed the only thing a refusal did was print a sentence: the
 * send button stayed live, the obvious next move was to press it again, and
 * pressing it again inside the same window produced a second refusal — which
 * is exactly what it looks like when an app has stopped working.
 */
interface Cooldown {
  /** "burst" clears itself in seconds; "daily" lasts until the allowance resets. */
  kind: "burst" | "daily";
  /** Only used for "daily" — the burst wording is generated from the countdown. */
  message: string;
  /** Epoch milliseconds. */
  until: number;
}

const LIMIT_CODES = ["rate_limit", "usage_limit", "daily_limit"];

/** Whole seconds until `until`, never negative. */
function secondsUntil(until: number | null): number {
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/**
 * Counts down to `until`, re-rendering once a second and stopping at zero. Pass
 * null when there is nothing to wait for and no timer is started at all.
 */
function useSecondsUntil(until: number | null): number {
  const [left, setLeft] = useState(() => secondsUntil(until));

  useEffect(() => {
    setLeft(secondsUntil(until));
    if (until === null) return;

    const id = window.setInterval(() => {
      const next = secondsUntil(until);
      setLeft(next);
      if (next === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  return left;
}

const SUGGESTIONS = [
  "I have been the same weight for 3 weeks — what should I change?",
  "How much protein should I eat to build muscle?",
  "Give me a 500 kcal high-protein lunch idea",
];

/**
 * A chat screen, not a scrolling page: the composer is pinned directly above
 * the navigation and only the transcript moves.
 */
export function CoachPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);
  const [usage, setUsage] = useState<UsageAllowance>({ chat: null, vision: null });

  // Only a reply that arrived in this session is typed out. Replaying the
  // whole history letter by letter on every visit would be infuriating.
  const [animatingId, setAnimatingId] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadChatHistory()
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
  }, []);

  useEffect(() => {
    void Promise.all([getAiUsage("chat"), getAiUsage("vision")])
      .then(([chat, vision]) => setUsage({ chat, vision }))
      .catch(() => {
        // The remaining-calls line is a courtesy, not a requirement. The coach
        // still works without it, and the server enforces the limit regardless.
      });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, sending]);

  const attachFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhoto(await prepareImage(file));
    } catch (reason) {
      setError(presentError(reason, "Could not read that image."));
    }
  };

  const attachFromCamera = async (source: "camera" | "gallery") => {
    if (!isNative) {
      fileRef.current?.click();
      return;
    }
    setError(null);
    try {
      const captured = await capturePhoto(source);
      if (captured) setPhoto(captured);
    } catch {
      // The user dismissed the camera sheet, which is not an error.
    }
  };

  // What the current send would draw from. A photo and a message come out of
  // different allowances, so being out of one says nothing about the other.
  const bucket = photo ? usage.vision : usage.chat;
  const noneLeftToday = bucket ? bucket.used >= bucket.dailyLimit : false;

  const waitSeconds = useSecondsUntil(cooldown?.kind === "burst" ? cooldown.until : null);
  const waiting = waitSeconds > 0;
  const outOfCalls = cooldown?.kind === "daily" || noneLeftToday;
  const blocked = waiting || outOfCalls;

  /**
   * The one line shown while a limit is in force. It replaces the error alert
   * rather than joining it: two notices about the same refusal is one too many.
   */
  const limitNotice = (() => {
    if (waiting) {
      return waitSeconds === 1
        ? "Give the coach a second to catch up — you can send again in 1 second."
        : `Give the coach a second to catch up — you can send again in ${waitSeconds} seconds.`;
    }
    if (cooldown?.kind === "daily") return cooldown.message;
    if (noneLeftToday && bucket) {
      return `You have used all ${bucket.dailyLimit} of today's ` +
        `${photo ? "photo estimates" : "coach messages"}. Your allowance resets in ` +
        `${formatTimeUntil(bucket.resetsAt)} — everything else in the app still works.`;
    }
    return null;
  })();

  const send = async (event?: FormEvent, overrideText?: string) => {
    event?.preventDefault();
    if (sending) return;

    // The composer is already standing down with the reason on screen, so
    // there is nothing to add and nothing to gain by asking the server again.
    // This is the guard that matters: the button is disabled, but a suggestion
    // chip calls straight through here.
    if (blocked) return;

    // Some Android keyboards hold a word in composition without committing it,
    // so React's value can trail what the user can plainly see. The box itself
    // is the authority on what they typed.
    const text = overrideText !== undefined
      ? overrideText.trim()
      : prompt.trim() || (promptRef.current?.value ?? "").trim();
    // Every message carries text; the photo is the optional part. Saying so
    // beats returning in silence: a send button that does nothing reads as a
    // broken app, and the user has no idea the note is what is missing.
    if (!text) {
      setError(
        photo
          ? "Add a note saying what this is before sending the photo."
          : "Type a message first.",
      );
      return;
    }

    setSending(true);
    setError(null);
    setCooldown(null);

    const optimistic: ChatMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      text,
      imagePreviewUrl: photo?.previewUrl,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setPrompt("");

    try {
      let imagePath: string | undefined;
      if (photo) {
        // A photo with no session cannot be uploaded, and quietly sending the
        // message without it would answer a question about a picture the model
        // never saw. Better to stop and say so.
        if (!user) throw new Error("You have been signed out. Sign in again to send a photo.");
        imagePath = await uploadMealPhoto(user.id, photo.blob);
      }

      const response = await sendChatMessage(text, imagePath);
      const id = response.messageId ?? `local-${crypto.randomUUID()}`;

      setMessages((current) => [
        ...current,
        {
          id,
          role: "assistant",
          text: response.reply,
          estimate: response.estimate ?? null,
          suggestions: response.suggestions ?? [],
          plan: response.plan ?? null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setAnimatingId(id);
      if (response.usage) setUsage(withUsage(response.usage));

      // Cleared only once the exchange has actually completed. A failure keeps
      // both the photo and the words, because the next thing the user will do
      // is press send again.
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (reason) {
      const message = presentError(reason, "The coach could not answer that.");

      // Three different limits, none of them a fault: "rate_limit" is a few
      // seconds, "usage_limit" is this user's allowance for the day, and
      // "daily_limit" is the whole service out of quota. Each becomes a
      // cooldown rather than a message, so the composer stands itself down for
      // as long as it lasts instead of inviting a retry that cannot succeed.
      const payload =
        reason instanceof FunctionError
          ? (reason.payload as { code?: string; usage?: UsageState } | null)
          : null;

      if (payload?.code && LIMIT_CODES.includes(payload.code)) {
        if (payload.usage) setUsage(withUsage(payload.usage));

        if (payload.code === "rate_limit") {
          // A second either way is not worth an argument, and rounding up is
          // the side to be wrong on: a countdown that ends a moment early
          // sends the user straight back into the same refusal.
          const seconds = Math.max(1, payload.usage?.retryAfter ?? 30);
          setCooldown({ kind: "burst", message, until: Date.now() + seconds * 1000 });
        } else {
          setCooldown({ kind: "daily", message, until: Date.now() });
        }
      } else {
        setError(message);
      }

      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setPrompt(text);
    } finally {
      setSending(false);
    }
  };

  const hasText = Boolean(prompt.trim());

  const clear = async () => {
    if (!user) return;
    try {
      await clearChatHistory(user.id);
      setMessages([]);
    } catch (reason) {
      setError(presentError(reason, "Could not clear the chat."));
    }
  };

  return (
    <div className="mx-auto flex h-app w-full max-w-3xl flex-col px-3 sm:px-6">
      <div className="flex shrink-0 items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Nutrition coach</h1>
          <p className="truncate text-[12px] text-ink-muted">
            Food, weight loss, muscle gain — or photograph a meal to log it.
          </p>
        </div>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            <Trash2 size={15} />
            <span className="sr-only sm:not-sr-only">Clear</span>
          </Button>
        )}
      </div>

      <UsageBanner usage={usage} />

      <div
        ref={scrollRef}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface px-3 py-3 sm:px-4"
      >
        {loadingHistory ? (
          <ChatSkeleton />
        ) : messages.length === 0 ? (
          <Welcome onPick={(text) => void send(undefined, text)} />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              animate={message.id === animatingId}
              onLogged={(id) => {
                setMessages((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, loggedAt: new Date().toISOString() } : item,
                  ),
                );
                // Remembered on the message itself, so reopening the app does
                // not offer the same meal again — and logging it twice.
                // Locally-generated ids belong to no stored row.
                if (!id.startsWith("local-")) void markEstimateLogged(id);
              }}
              onPlanApplied={(id) =>
                setMessages((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, planAppliedAt: new Date().toISOString() } : item,
                  ),
                )
              }
            />
          ))
        )}

        {sending && (
          <div className="my-4 flex gap-2.5">
            <Avatar />
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3">
              <Dot delay="0ms" />
              <Dot delay="140ms" />
              <Dot delay="280ms" />
              <span className="ml-1 text-[12px] text-ink-muted">
                {photo ? "Reading your photo…" : "Thinking…"}
              </span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={(event) => void send(event)} className="shrink-0 pb-3 pt-2">
        {photo && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2 py-2">
            <img
              src={photo.previewUrl}
              alt="Meal to analyse"
              className="size-10 rounded-lg object-cover"
            />
            <span className="flex-1 text-[12px] text-ink-muted">
              {prompt.trim() ? "Photo ready to analyse" : "Say what this is to send it"}
            </span>
            <IconButton label="Remove photo" onClick={() => setPhoto(null)}>
              <X size={16} />
            </IconButton>
          </div>
        )}

        {/* A limit is a wait, not a fault, so it is never dressed as one — and
            it takes the place of the error alert rather than stacking with it,
            because both would be describing the same refusal. */}
        {limitNotice ? (
          <Alert tone="warn" className="mb-2">
            {limitNotice}
          </Alert>
        ) : error ? (
          <Alert tone="error" className="mb-2">
            {error}
          </Alert>
        ) : null}

        <div className="flex items-center gap-1.5 rounded-2xl border border-line bg-surface p-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void attachFromFile(event)}
            className="sr-only"
          />
          <button
            type="button"
            onClick={() => void attachFromCamera("camera")}
            aria-label="Take a meal photo"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand transition-transform active:scale-90"
          >
            <Camera size={19} />
          </button>
          {isNative && (
            <button
              type="button"
              onClick={() => void attachFromCamera("gallery")}
              aria-label="Choose a photo"
              className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-muted transition-transform active:scale-90"
            >
              <Images size={19} />
            </button>
          )}

          <input
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              outOfCalls
                ? "Back tomorrow…"
                : waiting
                  ? "Just a moment…"
                  : photo
                    ? "Say what this is…"
                    : "Ask about food…"
            }
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent px-1 text-[15px] outline-none"
          />

          <button
            type="submit"
            // Keeps focus in the box for the length of the tap. Without it the
            // input blurs first, the keyboard starts to close, the composer
            // moves down with it and the tap lands where the button no longer
            // is — which reads as a send button that sometimes does nothing.
            onMouseDown={(event) => event.preventDefault()}
            // Disabled only while a send is in flight, or while a limit means
            // pressing it cannot possibly work. Greying it out on empty state
            // looks tidier but takes the tap away entirely, and a keyboard
            // holding a word in composition leaves state empty under text the
            // user can see — so the button they are looking straight at stops
            // responding. Empty keeps it tappable and says what is missing; a
            // limit does the opposite, because the reason is already on screen
            // and another tap only earns them a second refusal.
            disabled={sending || blocked}
            aria-disabled={!hasText}
            aria-label={waiting ? `Send — available in ${waitSeconds} seconds` : "Send"}
            className={cx(
              "grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white transition-transform active:scale-90",
              (!hasText || blocked) && "opacity-35",
            )}
          >
            {/* The countdown sits on the button itself, where the tap would
                have gone, so the wait is visible at the point of frustration
                rather than only in a line of text above it. */}
            {waiting ? (
              <span className="text-[12px] font-semibold tabular-nums">{waitSeconds}</span>
            ) : (
              <Send size={17} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * What is left of today's two allowances. It stays out of the way until it
 * matters: the numbers are quiet grey, and the whole line is absent entirely
 * until the counts have actually been read.
 */
function UsageBanner({ usage }: { usage: UsageAllowance }) {
  if (!usage.chat && !usage.vision) return null;

  // Both buckets reset at the same midnight, so one countdown covers them.
  const resetsAt = usage.chat?.resetsAt ?? usage.vision?.resetsAt;

  return (
    <p className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-[11px] text-ink-muted">
      {usage.chat && <Remaining state={usage.chat} noun="messages" />}
      {usage.vision && <Remaining state={usage.vision} noun="photos" />}
      {resetsAt && (
        <span className="ml-auto text-ink-faint">Resets in {formatTimeUntil(resetsAt)}</span>
      )}
    </p>
  );
}

function Remaining({ state, noun }: { state: UsageState; noun: string }) {
  const left = Math.max(state.dailyLimit - state.used, 0);
  return (
    <span>
      <strong className={cx("font-medium", left === 0 ? "text-warn" : "text-ink")}>{left}</strong>
      {" "}of {state.dailyLimit} {noun} left today
    </span>
  );
}

function ChatSkeleton() {
  return (
    <div role="status" aria-label="Loading your conversation" className="grid gap-5 py-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className={cx("flex gap-2.5", index % 2 === 1 && "justify-end")}>
          {index % 2 === 0 && <Skeleton className="size-8 shrink-0 rounded-lg" />}
          <Skeleton className={cx("h-16 rounded-2xl", index % 2 === 1 ? "w-1/2" : "w-3/4")} />
        </div>
      ))}
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Sparkles size={22} />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">What can I help with?</h2>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
        Ask a nutrition question, or photograph a meal and I will estimate it so you can log it.
      </p>

      <div className="mt-5 grid w-full max-w-sm gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onPick(suggestion)}
            className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[13px] transition-colors hover:border-brand/40 hover:bg-brand-soft"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {/* Said once, here, rather than under every reply: a caveat repeated on
          each message stops being read after the second one. */}
      <p className="mt-6 max-w-sm text-[11px] leading-relaxed text-ink-faint">
        The coach gives you the best answer it can, but it can be wrong. Use your own judgement,
        and check with a dietitian or your GP before acting on anything that matters — especially
        if you are pregnant, unwell, or managing a medical condition.
      </p>
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
      <Bot size={16} />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <i
      className="size-1.5 animate-bounce rounded-full bg-brand"
      style={{ animationDelay: delay, animationDuration: "1s" }}
    />
  );
}

function MessageBubble({
  message,
  animate,
  onLogged,
  onPlanApplied,
}: {
  message: ChatMessage;
  animate: boolean;
  onLogged: (id: string) => void;
  onPlanApplied: (id: string) => void;
}) {
  const typed = useTypewriter(message.text, animate && message.role === "assistant");

  if (message.role === "user") {
    return (
      <div className="my-4 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-olive px-3.5 py-2.5">
          {message.imagePreviewUrl && (
            <img
              src={message.imagePreviewUrl}
              alt="Uploaded meal"
              className="mb-2 max-h-52 w-52 rounded-lg object-cover"
            />
          )}
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  const stillTyping = typed.length < message.text.length;

  return (
    <div className="my-4 flex gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
          {typed}
          {stillTyping && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-brand align-middle" />
          )}
        </p>
        {/* Cards wait until the sentence has finished arriving. */}
        {message.estimate && !stillTyping && (
          <EstimateCard
            estimate={message.estimate}
            logged={Boolean(message.loggedAt)}
            onLogged={() => onLogged(message.id)}
          />
        )}

        {message.plan && !stillTyping && (
          <PlanCard
            plan={message.plan as CoachPlan}
            applied={Boolean(message.planAppliedAt)}
            onApplied={() => onPlanApplied(message.id)}
          />
        )}

        {!stillTyping && (message.suggestions?.length ?? 0) > 0 && (
          <SuggestionList suggestions={message.suggestions!} />
        )}
      </div>
    </div>
  );
}

/**
 * The AI never writes to the diary on its own. It proposes numbers; the user
 * corrects anything wrong and only then does it get logged.
 */
function EstimateCard({
  estimate,
  logged,
  onLogged,
}: {
  estimate: MealEstimate;
  logged: boolean;
  onLogged: () => void;
}) {
  const { logFood, date, refresh } = useAppData();
  const [lines, setLines] = useState<EstimateLine[]>(estimate.lines ?? []);
  const [meal, setMeal] = useState<MealName>("Lunch");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // With an itemised estimate the totals are never stored, only derived — so a
  // corrected amount, a removed ingredient and an added one all land in the
  // same place and cannot drift apart from the figure that gets logged.
  const itemised = lines.length > 0;
  const totals = totalsForLines(lines);

  // Older estimates predate the itemised breakdown, so their macros stay
  // directly editable rather than losing the ability to be corrected at all.
  const [values, setValues] = useState({
    calories: estimate.calories,
    protein: estimate.protein_g,
    carbs: estimate.carbs_g,
    fat: estimate.fat_g,
  });

  const set = (key: keyof typeof values, raw: string) => {
    const number = Number(raw);
    setValues((current) => ({
      ...current,
      [key]: Number.isFinite(number) && number >= 0 ? number : 0,
    }));
  };

  const log = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const logged = itemised ? totals : { ...values, fibre: estimate.fibre_g };
      await logFood({
        name: estimate.dish_name || "Photo estimate",
        amount: 1,
        unit: "meal",
        meal,
        // Whole kcal, tenths of a gram — the same shape every other way of
        // logging food produces (see scaleIngredient and scaleRecipe). Nothing
        // in the app has ever shown a fractional calorie: every readout rounds
        // it away, so the decimal was precision no one could see, on the one
        // path that stored it differently from all the others.
        calories: Math.round(logged.calories),
        protein: round1(logged.protein),
        carbs: round1(logged.carbs),
        fat: round1(logged.fat),
        fibre: round1(logged.fibre),
        date,
        source: "ai_photo",
        // What the figure was actually based on, as it stood when it was
        // logged — including anything the user corrected, added or removed.
        notes: [
          estimate.description,
          (itemised ? lines.map((line) => `${Math.round(line.amount)}${line.unit} ${line.name}`) : estimate.ingredients ?? []).join(", "),
        ].filter(Boolean).join(" — ") || null,
      });
      onLogged();
      // Today's totals were computed before this entry existed.
      void refresh();
    } catch (reason) {
      setError(presentError(reason, "Could not add that to your diary."));
    } finally {
      setBusy(false);
    }
  };

  // Once it is logged the whole card goes and one quiet line takes its place.
  // Leaving an editor on screen that no longer edits anything is clutter, and
  // it invites a second tap that would log the meal twice.
  if (logged) {
    return (
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[12px] font-medium text-ok">
        <Check size={14} /> Added to your diary
      </p>
    );
  }

  return (
    <div className="animate-fade-in mt-3 border-t border-line pt-3">
      {itemised ? (
        <>
          <p className="mb-1.5 text-[11px] text-ink-muted">
            Change an amount if it looks wrong — the totals follow. Add anything missing, or
            remove what is not there.
          </p>

          <IngredientLines lines={lines} onChange={setLines} />

          <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11px] text-ink-muted">
            <div className="flex items-baseline gap-1">
              <dt className="sr-only">Calories</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-ink">
                {Math.round(totals.calories)}
              </dd>
              <span>kcal</span>
            </div>
            <div className="flex items-baseline gap-1">
              <dt>protein</dt>
              <dd className="font-medium tabular-nums text-ink">{round1(totals.protein)}g</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt>carbs</dt>
              <dd className="font-medium tabular-nums text-ink">{round1(totals.carbs)}g</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt>fat</dt>
              <dd className="font-medium tabular-nums text-ink">{round1(totals.fat)}g</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          {(estimate.ingredients?.length ?? 0) > 0 && (
            <div className="mb-2.5">
              <p className="mb-1 text-[11px] font-medium text-ink-muted">
                Based on these ingredients
              </p>
              <ul className="grid gap-0.5 text-[11px] leading-relaxed text-ink-muted">
                {estimate.ingredients!.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-ink-faint">
                      &middot;
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-2 text-[11px] text-ink-muted">
            Check these before logging — edit anything that looks wrong.
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MacroInput label="kcal" value={values.calories} onChange={(v) => set("calories", v)} />
            <MacroInput label="protein" value={values.protein} onChange={(v) => set("protein", v)} />
            <MacroInput label="carbs" value={values.carbs} onChange={(v) => set("carbs", v)} />
            <MacroInput label="fat" value={values.fat} onChange={(v) => set("fat", v)} />
          </div>
        </>
      )}

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <select
          value={meal}
          onChange={(event) => setMeal(event.target.value as MealName)}
          className={cx(inputClass, "min-h-10 flex-1 py-0 text-[13px]")}
          aria-label="Meal"
        >
          {MEALS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void log()}
          disabled={busy || (itemised && lines.length === 0)}
        >
          <Check size={15} /> {busy ? "Adding…" : "Add to diary"}
        </Button>
      </div>

      <p className="mt-2 text-[11px] capitalize text-ink-faint">
        Confidence: {estimate.confidence}
      </p>
    </div>
  );
}

/**
 * Meals the coach named in prose. Each opens the same editable card the photo
 * estimate uses, so the user always corrects the numbers before they land in
 * the diary — the AI never writes one on its own.
 */
function SuggestionList({ suggestions }: { suggestions: MealSuggestion[] }) {
  // Every named meal opens with its numbers showing. Collapsing them hid the
  // only way to save a meal behind a tap nobody knew to make, and the whole
  // point of the card is that the user checks the figures before logging —
  // which they cannot do if the figures are not on screen.
  const [closed, setClosed] = useState<string[]>([]);
  const [logged, setLogged] = useState<string[]>([]);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-[11px] font-medium text-ink-muted">
        {suggestions.length === 1 ? "Add this to your diary" : "Add to your diary"} — check the
        numbers first.
      </p>

      <div className="grid min-w-0 gap-2">
        {suggestions.map((suggestion) => {
          const isLogged = logged.includes(suggestion.name);
          const isOpen = !closed.includes(suggestion.name);

          if (isLogged) {
            return (
              <p
                key={suggestion.name}
                className="flex items-center gap-1.5 text-[12px] font-medium text-ok"
              >
                <Check size={14} /> {suggestion.name} added
              </p>
            );
          }

          return (
            <div
              key={suggestion.name}
              className="min-w-0 rounded-xl border border-line bg-surface p-2.5"
            >
              <button
                onClick={() =>
                  setClosed((current) =>
                    isOpen
                      ? [...current, suggestion.name]
                      : current.filter((name) => name !== suggestion.name),
                  )
                }
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <ScrollingText className="text-[13px] font-medium" title={suggestion.name}>
                    {suggestion.name}
                  </ScrollingText>
                  <span className="block text-[11px] tabular-nums text-ink-muted">
                    {Math.round(suggestion.calories)} kcal · P {Math.round(suggestion.protein_g)} ·
                    C {Math.round(suggestion.carbs_g)} · F {Math.round(suggestion.fat_g)}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand">
                  {isOpen ? (
                    <>
                      <X size={13} /> Hide
                    </>
                  ) : (
                    <>
                      <Plus size={13} /> Add
                    </>
                  )}
                </span>
              </button>

              {isOpen && (
                <EstimateCard
                  estimate={toEstimate(suggestion)}
                  logged={false}
                  onLogged={() => setLogged((current) => [...current, suggestion.name])}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toEstimate(suggestion: MealSuggestion): MealEstimate {
  return {
    dish_name: suggestion.name,
    description: "",
    ingredients: suggestion.ingredients ?? [],
    calories: suggestion.calories,
    protein_g: suggestion.protein_g,
    carbs_g: suggestion.carbs_g,
    fat_g: suggestion.fat_g,
    fibre_g: suggestion.fibre_g,
    confidence: "medium",
    summary: "",
    is_food: true,
  };
}

function MacroInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
      <input
        type="number"
        min="0"
        step="0.1"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-center text-[14px] font-semibold tabular-nums outline-none focus:border-brand"
      />
    </label>
  );
}
