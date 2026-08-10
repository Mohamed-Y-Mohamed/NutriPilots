import {
  Bot,
  Camera,
  Check,
  Images,
  Info,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Alert,
  Button,
  Card,
  cx,
  IconButton,
  inputClass,
  Page,
  PageHeader,
  Spinner,
} from "../components/ui";
import { prepareImage } from "../lib/image";
import { capturePhoto, isNative } from "../lib/native";
import {
  clearChatHistory,
  loadChatHistory,
  sendChatMessage,
  uploadMealPhoto,
} from "../services/aiClient";
import { useAppData } from "../state/AppDataContext";
import { useAuth } from "../state/AuthContext";
import { MEALS, type ChatMessage, type MealEstimate, type MealName } from "../types";

const SUGGESTIONS = [
  "I have been the same weight for 3 weeks — what should I change?",
  "How much protein should I eat to build muscle?",
  "Give me a 500 kcal high-protein lunch idea",
];

export function CoachPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadChatHistory()
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
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
      const prepared = await prepareImage(file);
      setPhoto(prepared);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read that image.");
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
      // The user cancelled the camera sheet, which is not an error.
    }
  };

  const send = async (event?: FormEvent, overrideText?: string) => {
    event?.preventDefault();
    const text = (overrideText ?? prompt).trim();
    if (sending || (!text && !photo)) return;

    setSending(true);
    setError(null);

    const optimistic: ChatMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      text: text || "Estimate the nutrition in this meal.",
      imagePreviewUrl: photo?.previewUrl,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setPrompt("");

    try {
      let imagePath: string | undefined;
      if (photo && user) {
        imagePath = await uploadMealPhoto(user.id, photo.blob);
      }

      const response = await sendChatMessage(text, imagePath);

      setMessages((current) => [
        ...current,
        {
          id: response.messageId ?? `local-${crypto.randomUUID()}`,
          role: "assistant",
          text: response.reply,
          estimate: response.estimate ?? null,
          createdAt: new Date().toISOString(),
        },
      ]);

      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "The coach could not answer that.";
      // The only quota message a user ever sees. Model switching below this is
      // silent by design.
      if (/today's ai limit/i.test(message)) setLimitReached(true);
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setPrompt(text);
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    if (!user) return;
    try {
      await clearChatHistory(user.id);
      setMessages([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not clear the chat.");
    }
  };

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Nutrition coach"
        subtitle="Ask about food, weight loss, muscle gain or a plateau — or photograph a meal to log it."
        actions={
          messages.length > 0 ? (
            <Button size="sm" onClick={() => void clear()}>
              <Trash2 size={15} /> Clear
            </Button>
          ) : undefined
        }
      />

      <Card className="flex h-[calc(100svh-16rem)] min-h-104 flex-col overflow-hidden lg:h-152">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {loadingHistory ? (
            <Spinner label="Loading your conversation…" />
          ) : messages.length === 0 ? (
            <Welcome onPick={(text) => void send(undefined, text)} />
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onLogged={(id) =>
                  setMessages((current) =>
                    current.map((item) =>
                      item.id === id ? { ...item, loggedAt: new Date().toISOString() } : item,
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

        <form onSubmit={(event) => void send(event)} className="border-t border-line bg-muted/50 p-3">
          {photo && (
            <div className="mb-2 flex items-center gap-2.5 px-1">
              <img
                src={photo.previewUrl}
                alt="Meal to analyse"
                className="size-11 rounded-lg object-cover"
              />
              <span className="flex-1 text-[12px] text-ink-muted">Photo ready to analyse</span>
              <IconButton label="Remove photo" onClick={() => setPhoto(null)}>
                <X size={16} />
              </IconButton>
            </div>
          )}

          {(error || limitReached) && (
            <Alert tone={limitReached ? "warn" : "error"} className="mb-2">
              {error}
            </Alert>
          )}

          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => void attachFromFile(event)}
              className="sr-only"
              id="meal-photo"
            />
            <button
              type="button"
              onClick={() => void attachFromCamera("camera")}
              aria-label="Take a meal photo"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"
            >
              <Camera size={19} />
            </button>
            {isNative && (
              <button
                type="button"
                onClick={() => void attachFromCamera("gallery")}
                aria-label="Choose a photo"
                className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-muted"
              >
                <Images size={19} />
              </button>
            )}

            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={photo ? "Add a note, e.g. “the sauce is mayo”" : "Ask about food…"}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              enterKeyHint="send"
            />

            <button
              type="submit"
              disabled={sending || (!prompt.trim() && !photo)}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white disabled:opacity-35"
            >
              <Send size={17} />
            </button>
          </div>
        </form>
      </Card>

      <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
        <Info size={14} className="mt-0.5 shrink-0" />
        The coach answers food and body-composition questions only. Estimates are approximate —
        photos are deleted straight after analysis.
      </p>
    </Page>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-4 text-center">
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
  onLogged,
}: {
  message: ChatMessage;
  onLogged: (id: string) => void;
}) {
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
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-white">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 flex gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{message.text}</p>
        {message.estimate && (
          <EstimateCard
            estimate={message.estimate}
            logged={Boolean(message.loggedAt)}
            onLogged={() => onLogged(message.id)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The AI never writes to the diary on its own. It proposes numbers; the user
 * corrects anything that looks wrong and only then does it get logged.
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
  const { logFood, date } = useAppData();
  const [values, setValues] = useState({
    calories: estimate.calories,
    protein: estimate.protein_g,
    carbs: estimate.carbs_g,
    fat: estimate.fat_g,
  });
  const [meal, setMeal] = useState<MealName>("Lunch");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await logFood({
        name: estimate.dish_name || "Photo estimate",
        amount: 1,
        unit: "meal",
        meal,
        calories: values.calories,
        protein: values.protein,
        carbs: values.carbs,
        fat: values.fat,
        fibre: estimate.fibre_g,
        date,
        source: "ai_photo",
        notes: estimate.description || null,
      });
      onLogged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that to your diary.");
    } finally {
      setBusy(false);
    }
  };

  if (logged) {
    return (
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[12px] font-medium text-ok">
        <Check size={14} /> Added to your diary
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-[11px] text-ink-muted">
        Check these before logging — edit anything that looks wrong.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MacroInput label="kcal" value={values.calories} onChange={(v) => set("calories", v)} />
        <MacroInput label="protein" value={values.protein} onChange={(v) => set("protein", v)} />
        <MacroInput label="carbs" value={values.carbs} onChange={(v) => set("carbs", v)} />
        <MacroInput label="fat" value={values.fat} onChange={(v) => set("fat", v)} />
      </div>

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <select
          value={meal}
          onChange={(event) => setMeal(event.target.value as MealName)}
          className={cx(inputClass, "min-h-10 w-auto flex-1 py-0 text-[13px]")}
          aria-label="Meal"
        >
          {MEALS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={() => void log()} disabled={busy}>
          <Check size={15} /> {busy ? "Adding…" : "Confirm & log"}
        </Button>
      </div>

      <p className="mt-2 text-[11px] capitalize text-ink-faint">
        Confidence: {estimate.confidence}
      </p>
    </div>
  );
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
