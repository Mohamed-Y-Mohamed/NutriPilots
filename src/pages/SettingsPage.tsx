import {
  Bot,
  Database,
  FileText,
  Info,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  ShieldAlert,
  Sun,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { DailyTargetsEditor } from "../components/DailyTargetsEditor";
import { LegalSheet } from "../components/LegalSheet";
import {
  Alert,
  Button,
  Card,
  CollapsibleCard,
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
import { assessPassword } from "../lib/validation";
import { useAppData } from "../state/AppDataContext";
import { useAuth } from "../state/AuthContext";
import { useTheme } from "../state/ThemeContext";
import type { ThemePreference } from "../types";

import { presentError } from "../lib/errors";
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

type PendingAction = "diary" | "chat" | "photos" | "health" | null;

/**
 * Every section collapses. Settings is a long list of things touched rarely,
 * and showing all of it at once buries the two or three controls anyone came
 * for. Signing out sits at the very bottom, below the destructive actions, so
 * it is never the thing a thumb finds by accident.
 */
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
  const [changingPassword, setChangingPassword] = useState(false);

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
      setError(presentError(reason, "That did not work. Please try again."));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Page className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Appearance, your data, and your account." />

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

      <div className="grid gap-3">
        <CollapsibleCard
          icon={<Target size={17} />}
          title="Daily targets"
          description="What the ring and the macro bars measure you against."
        >
          <DailyTargetsEditor />
        </CollapsibleCard>

        <CollapsibleCard
          icon={<Sun size={17} />}
          title="Appearance"
          description="System follows your phone's light and dark setting."
        >
          <fieldset>
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
        </CollapsibleCard>

        <CollapsibleCard
          icon={<UserRound size={17} />}
          title="Account"
          description={user?.email ?? "Signed in with email and password."}
        >
          {user && (
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">
                {(user.email?.[0] ?? "U").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{user.email}</span>
                <span className="block text-[12px] text-ink-muted">Signed in</span>
              </span>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
            <div className="min-w-0">
              <p className="text-[14px] font-medium">Password</p>
              <p className="text-[12px] text-ink-muted">Change the password you sign in with.</p>
            </div>
            <Button size="sm" onClick={() => setChangingPassword(true)}>
              <KeyRound size={15} /> Change
            </Button>
          </div>
        </CollapsibleCard>

        <CollapsibleCard
          icon={<Database size={17} />}
          title="Your data"
          description="Delete any part of your data. This cannot be undone."
        >
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
        </CollapsibleCard>

        <CollapsibleCard
          icon={<Bot size={17} />}
          title="How the coach works"
          description="What happens to your messages and photos."
        >
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Photos are uploaded only for the moment it takes to analyse them and are deleted
            immediately afterwards. A short text description is kept for 30 days so you can look
            back at what you logged, then removed automatically. Your API access is handled
            entirely on the server &mdash; no keys ever reach this device.
          </p>
          <button
            onClick={() => setShowTerms(true)}
            className="mt-3 inline-flex min-h-9 items-center gap-2 text-[13px] font-medium text-brand"
          >
            <FileText size={15} /> Read the Terms of Use &amp; Privacy
          </button>
        </CollapsibleCard>

        <CollapsibleCard
          icon={<Info size={17} />}
          title="About"
          description="Which version of the app you are running."
        >
          {/* The app's own build only, and only because it is what support
              would ask for. Which build of the server answered, and what it
              runs on, are ours to know. */}
          <dl className="grid gap-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">App version</dt>
              <dd className="font-medium tabular-nums">{__BUILD_ID__}</dd>
            </div>
          </dl>
        </CollapsibleCard>

        <CollapsibleCard
          danger
          icon={<ShieldAlert size={17} />}
          title="Delete your account"
          description="Removes your account and everything in it, permanently."
        >
          <Button variant="danger" full onClick={() => setShowDeleteAccount(true)}>
            <Trash2 size={16} /> Delete my account
          </Button>
        </CollapsibleCard>

        {/* Last on the page on purpose: below the destructive actions, where a
            thumb reaching for something else cannot land on it. */}
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold tracking-tight">Sign out</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Your data stays exactly as it is.
              </p>
            </div>
            <Button onClick={() => void signOut()}>
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        </Card>
      </div>

      {changingPassword && (
        <ChangePasswordSheet onClose={() => setChangingPassword(false)} />
      )}

      {showDeleteAccount && (
        <DeleteAccountSheet onClose={() => setShowDeleteAccount(false)} />
      )}
      {showTerms && <LegalSheet onClose={() => setShowTerms(false)} />}
    </Page>
  );
}

/** Already signed in, so this needs no email round trip. */
function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessment = assessPassword(password);
  const matches = confirmation.length > 0 && confirmation === password;
  const ready = assessment.allRulesMet && matches;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (reason) {
      setError(presentError(reason, "Could not update your password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Change password"
      description="You stay signed in here. Anywhere else will need the new password."
      onClose={onClose}
      footer={
        done ? (
          <Button variant="primary" size="lg" full onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            {error && <Alert tone="error">{error}</Alert>}
            <Button
              variant="primary"
              size="lg"
              full
              disabled={!ready || busy}
              onClick={() => void save()}
            >
              {busy ? "Saving..." : "Save new password"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success">Your password has been updated.</Alert>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className={labelClass}>New password</span>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </label>

          {password.length > 0 && (
            <div className="grid gap-1 text-[12px]">
              {assessment.rules.map((rule) => (
                <span
                  key={rule.id}
                  className={cx(
                    "flex items-center gap-1.5",
                    rule.met ? "text-ok" : "text-ink-faint",
                  )}
                >
                  {rule.label}
                </span>
              ))}
            </div>
          )}

          <label className="grid gap-1.5">
            <span className={labelClass}>Confirm new password</span>
            <input
              type="password"
              className={cx(inputClass, confirmation.length > 0 && !matches && "border-danger")}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
            />
            {confirmation.length > 0 && !matches && (
              <span className="text-[11px] text-danger">Those two passwords do not match.</span>
            )}
          </label>
        </div>
      )}
    </Sheet>
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
        presentError(reason, "Could not delete the account. Please try again."),
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

/** One deletable slice of the user's data, armed before it will fire. */
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-3 last:border-0 last:pb-0">
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
