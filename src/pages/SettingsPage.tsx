import {
  Bot,
  Database,
  FileText,
  LogOut,
  Monitor,
  Moon,
  ShieldAlert,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { LegalSheet } from "../components/LegalSheet";
import {
  Alert,
  Button,
  Card,
  cx,
  inputClass,
  labelClass,
  Page,
  PageHeader,
  Sheet,
} from "../components/ui";
import {
  clearChatHistory,
  clearMealPhotoRecords,
  deleteAccount,
} from "../services/aiClient";
import { useAppData } from "../state/AppDataContext";
import { useAuth } from "../state/AuthContext";
import { useTheme } from "../state/ThemeContext";
import type { ThemePreference } from "../types";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

type PendingAction = "diary" | "chat" | "photos" | "health" | null;

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const { diary, clearDiary, clearHealthData } = useAppData();

  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const run = async (action: Exclude<PendingAction, null>) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (action === "diary") {
        await clearDiary();
        setNotice("Your food diary has been deleted.");
      } else if (action === "chat") {
        await clearChatHistory(user.id);
        setNotice("Your coach conversation has been deleted.");
      } else if (action === "photos") {
        await clearMealPhotoRecords(user.id);
        setNotice("Your meal photo records have been deleted.");
      } else {
        await clearHealthData();
        setNotice("Your health data, goals and diary have been deleted.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Page className="max-w-2xl">
      <PageHeader
        title="Settings"
        subtitle="Appearance, your data, and your account."
      />

      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <div className="grid gap-4">
        <Card className="p-5">
          <SectionHead
            icon={<Sun size={17} />}
            title="Appearance"
            description="System follows your phone's light and dark setting."
          />

          <fieldset className="mt-4">
            <legend className="sr-only">Theme</legend>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = preference === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPreference(value)}
                    className={cx(
                      "grid min-h-20 place-items-center content-center gap-2 rounded-xl border p-3 text-[13px] font-medium transition-colors",
                      active
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-line bg-surface text-ink-muted hover:border-brand/40",
                    )}
                  >
                    <Icon size={19} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Card>

        <Card className="p-5">
          <SectionHead
            icon={<UserRound size={17} />}
            title="Account"
            description="Signed in with email and password."
          />

          {user && (
            <div className="mt-4 flex items-center gap-3 border-t border-line-soft pt-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
                {(user.email?.[0] ?? "U").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{user.email}</span>
                <span className="block text-[12px] text-ink-muted">Signed in</span>
              </span>
              <Button size="sm" onClick={() => void signOut()}>
                <LogOut size={15} /> Sign out
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHead
            icon={<Database size={17} />}
            title="Your data"
            description="Delete any part of your data. This cannot be undone."
          />

          <div className="mt-3">
            <DataRow
              label="Food diary"
              detail={`${diary.length} item${diary.length === 1 ? "" : "s"} logged today`}
              action="diary"
              pending={pending}
              busy={busy}
              onArm={setPending}
              onRun={run}
            />
            <DataRow
              label="Coach conversation"
              detail="Every message you have exchanged with the AI coach"
              action="chat"
              pending={pending}
              busy={busy}
              onArm={setPending}
              onRun={run}
            />
            <DataRow
              label="Meal photo records"
              detail="The 30-day text record of analysed photos"
              action="photos"
              pending={pending}
              busy={busy}
              onArm={setPending}
              onRun={run}
            />
            <DataRow
              label="All health data"
              detail="Body stats, goals and your entire diary"
              action="health"
              pending={pending}
              busy={busy}
              onArm={setPending}
              onRun={run}
            />
          </div>
        </Card>

        <Card className="p-5">
          <SectionHead
            icon={<Bot size={17} />}
            title="How the coach works"
            description="What happens to your messages and photos."
          />
          <p className="mt-3 border-t border-line-soft pt-3 text-[13px] leading-relaxed text-ink-muted">
            Photos are uploaded only for the moment it takes to analyse them and are deleted
            immediately afterwards. A short text description is kept for 30 days so you can look
            back at what you logged, then removed automatically. Your API access is handled
            entirely on the server — no keys ever reach this device.
          </p>
          <button
            onClick={() => setShowTerms(true)}
            className="mt-3 inline-flex min-h-9 items-center gap-2 text-[13px] font-medium text-brand"
          >
            <FileText size={15} /> Read the Terms of Use &amp; Privacy
          </button>
        </Card>

        <Card className="border-danger/30 p-5">
          <SectionHead
            danger
            icon={<ShieldAlert size={17} />}
            title="Delete your account"
            description="Removes your account and everything in it, permanently."
          />
          <Button
            variant="danger"
            className="mt-4"
            full
            onClick={() => setShowDeleteAccount(true)}
          >
            <Trash2 size={16} /> Delete my account
          </Button>
        </Card>
      </div>

      {showDeleteAccount && (
        <DeleteAccountSheet onClose={() => setShowDeleteAccount(false)} />
      )}
      {showTerms && <LegalSheet onClose={() => setShowTerms(false)} />}
    </Page>
  );
}

function SectionHead({
  icon,
  title,
  description,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cx(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          danger ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{description}</p>
      </div>
    </div>
  );
}

function DataRow({
  label,
  detail,
  action,
  pending,
  busy,
  onArm,
  onRun,
}: {
  label: string;
  detail: string;
  action: Exclude<PendingAction, null>;
  pending: PendingAction;
  busy: boolean;
  onArm: (action: PendingAction) => void;
  onRun: (action: Exclude<PendingAction, null>) => Promise<void>;
}) {
  const armed = pending === action;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{label}</p>
        <p className="text-[12px] text-ink-muted">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {armed && (
          <Button size="sm" variant="ghost" onClick={() => onArm(null)} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant={armed ? "danger" : "secondary"}
          disabled={busy}
          onClick={() => (armed ? void onRun(action) : onArm(action))}
        >
          {armed ? "Confirm delete" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Deleting an account is irreversible, so it asks for the word rather than a
 * button that can be hit by accident.
 */
function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const { signOutLocal } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = confirmation.trim().toUpperCase() === "DELETE";

  const remove = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // The account is gone, so the session token now refers to nobody. A
      // normal sign-out would fail against the server; clear it locally.
      await signOutLocal();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not delete the account. Please try again.",
      );
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Delete your account"
      description="This removes your profile, diary, library, coach history and photo records. It cannot be undone."
      onClose={onClose}
      footer={
        <>
          {error && <Alert tone="error">{error}</Alert>}
          <Button variant="danger" size="lg" full disabled={!ready || busy} onClick={() => void remove()}>
            <Trash2 size={16} /> {busy ? "Deleting…" : "Permanently delete my account"}
          </Button>
          <Button size="lg" full onClick={onClose} disabled={busy}>
            Keep my account
          </Button>
        </>
      }
    >
      <Alert tone="warn">
        Everything below is deleted permanently and cannot be recovered:
        <ul className="mt-2 list-disc pl-4">
          <li>Your profile, body stats and goals</li>
          <li>Every diary entry you have logged</li>
          <li>Your ingredient and recipe library</li>
          <li>Your coach conversation and meal photo records</li>
          <li>Your sign-in credentials</li>
        </ul>
      </Alert>

      <label className="mt-5 grid gap-1.5">
        <span className={labelClass}>
          Type <span className="font-semibold text-ink">DELETE</span> to confirm
        </span>
        <input
          className={inputClass}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="DELETE"
          autoCapitalize="characters"
          autoComplete="off"
        />
      </label>
    </Sheet>
  );
}
