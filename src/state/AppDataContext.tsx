import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  calculateDailyTargets,
  effectiveTargets,
  sumEntries,
  type DiaryTotals,
} from "../lib/nutrition";
import { localDateKey } from "../lib/dates";
import {
  calibrateMaintenance,
  summariseWeightTrend,
  type Calibration,
  type WeightTrend,
} from "../lib/weightTrend";
import {
  addDiaryEntry as addEntry,
  clearDiary as clearDiaryRows,
  loadDiary,
  removeDiaryEntry as removeEntry,
} from "../services/diaryRepository";
import { loadDailyTotals } from "../services/analyticsRepository";
import {
  deleteAllWeightLogs,
  loadWeightLogs,
  saveWeightLog,
} from "../services/weightRepository";
import {
  DEFAULT_PROFILE,
  loadProfile,
  resetHealthData,
  saveProfile,
} from "../services/profileRepository";
import type {
  DailyTargets,
  DiaryDraft,
  DiaryEntry,
  TargetsSource,
  UserProfile,
  WeightLog,
} from "../types";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";

import { presentError, userError } from "../lib/errors";
interface AppDataValue {
  profile: UserProfile;
  /** False until the user has actually saved their goals. */
  hasProfile: boolean;
  /** What the app measures against: an accepted plan, or the formula. */
  targets: DailyTargets;
  /** What the formula alone says, for comparing an override against. */
  calculatedTargets: DailyTargets;
  /** Recent weigh-ins, oldest first. Empty until the user starts logging. */
  weightLogs: WeightLog[];
  /** Week against week, both ends averaged. */
  weightTrend: WeightTrend;
  /**
   * Maintenance worked back from real results, or null when there is not yet
   * enough logging to support one. When it exists the targets above are built
   * from it rather than from the equation.
   */
  calibration: Calibration | null;
  /** Records this morning's weight, replacing any already logged for that day. */
  logWeight: (log: WeightLog) => Promise<void>;
  date: string;
  setDate: (date: string) => void;
  diary: DiaryEntry[];
  totals: DiaryTotals;
  isLoading: boolean;
  error: string | null;
  saveUserProfile: (profile: UserProfile) => Promise<void>;
  /** Replaces the daily targets, or clears them back to the formula with null. */
  saveTargets: (targets: DailyTargets | null, source: TargetsSource) => Promise<void>;
  logFood: (draft: DiaryDraft) => Promise<DiaryEntry>;
  removeDiaryEntry: (id: string) => Promise<void>;
  clearDiary: () => Promise<void>;
  clearHealthData: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * How far back the calibration inputs reach. Four weeks is the longest window
 * the trend maths uses, and loading more would be paid for on every app open
 * without changing an answer.
 */
const CALIBRATION_DAYS = 28;

function shiftDays(dateKey: string, back: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();

  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const [hasProfile, setHasProfile] = useState(false);
  const [date, setDate] = useState(() => localDateKey());
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [dayTotals, setDayTotals] = useState<Array<{ date: string; calories: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The theme lives in two places on purpose: localStorage so it applies before
  // the session resolves, and the profile so it follows the user to a new
  // device. This guard stops the two from writing over each other in a loop.
  const themeHydrated = useRef(false);

  /** Counts loads so a stale one can tell it has been superseded. */
  const loadSequence = useRef(0);

  const loadEverything = useCallback(async () => {
    if (!user) {
      setProfileState(DEFAULT_PROFILE);
      setDiary([]);
      setWeightLogs([]);
      setDayTotals([]);
      return;
    }

    /**
     * Which load this is. The Today screen steps between days with arrows, so
     * two taps in quick succession put two of these in flight at once — and
     * whichever server happens to answer last wins, not whichever day the user
     * is actually looking at. Every write below is gated on still being the
     * newest request, so a slow answer for yesterday cannot overwrite today.
     */
    const seq = loadSequence.current + 1;
    loadSequence.current = seq;
    const current = () => seq === loadSequence.current;

    setIsLoading(true);
    setError(null);
    try {
      const from = shiftDays(date, CALIBRATION_DAYS);

      const [loadedProfile, entries] = await withClockSkewRetry(() =>
        Promise.all([loadProfile(), loadDiary(date)]),
      );
      if (!current()) return;

      // Calibration inputs are loaded separately and are allowed to fail. They
      // improve a target; they are not needed to show one. A database a
      // migration behind, or an analytics view that is not there yet, must cost
      // the trend chart rather than the whole screen.
      const [weights, totals] = await Promise.all([
        loadWeightLogs(from).catch(() => [] as WeightLog[]),
        loadDailyTotals(from, date).catch(() => []),
      ]);
      if (!current()) return;

      setWeightLogs(weights);
      setDayTotals(totals.map((day) => ({ date: day.date, calories: day.calories })));

      if (loadedProfile?.onboarded) {
        setProfileState(loadedProfile);
        setHasProfile(true);
        if (!themeHydrated.current) {
          themeHydrated.current = true;
          if (loadedProfile.theme !== preference) setPreference(loadedProfile.theme);
        }
      } else {
        // A brand-new account gets no invented body stats — the dashboard asks
        // for them instead of showing a target derived from nothing.
        setProfileState({ ...DEFAULT_PROFILE, theme: loadedProfile?.theme ?? preference });
        setHasProfile(false);
        if (loadedProfile && !themeHydrated.current) {
          themeHydrated.current = true;
          if (loadedProfile.theme !== preference) setPreference(loadedProfile.theme);
        }
      }

      setDiary(entries);
    } catch (reason) {
      // A failure for a day the user has already navigated away from is not
      // their problem, and putting it on screen would blame the day they are
      // now looking at for something that happened to a different request.
      if (current()) setError(presentError(reason, "Could not load your data."));
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [user, date, preference, setPreference]);

  useEffect(() => {
    void loadEverything();
    // `preference` intentionally excluded: a theme toggle must not refetch the diary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, date]);

  useEffect(() => {
    if (!user || !themeHydrated.current || preference === profile.theme) return;
    const next = { ...profile, theme: preference };
    setProfileState(next);
    void saveProfile(user.id, next).catch(() => {
      // A failed theme sync is not worth interrupting the user for.
    });
  }, [preference, user, profile]);

  const saveUserProfile = useCallback(
    async (next: UserProfile) => {
      if (!user) throw userError("Please sign in to save your goals.");
      await saveProfile(user.id, next);
      setProfileState(next);
      setHasProfile(next.onboarded);
      themeHydrated.current = true;
    },
    [user],
  );

  const saveTargets = useCallback(
    async (targets: DailyTargets | null, source: TargetsSource) => {
      if (!user) throw userError("Please sign in to change your targets.");
      const next: UserProfile = {
        ...profile,
        targetOverride: targets,
        targetsSource: targets ? source : null,
        // Cleared rather than carried over, so "set on 3 Aug" cannot outlive
        // the numbers it described.
        targetsSetAt: targets ? new Date().toISOString() : null,
      };
      await saveProfile(user.id, next);
      setProfileState(next);
    },
    [user, profile],
  );

  const logFood = useCallback(
    async (draft: DiaryDraft) => {
      if (!user) throw userError("Please sign in to log food.");
      const entry = await addEntry(user.id, draft);
      // Only the day on screen needs updating; other days refetch when opened.
      if (entry.date === date) setDiary((current) => [...current, entry]);
      return entry;
    },
    [user, date],
  );

  const removeDiaryEntry = useCallback(async (id: string) => {
    await removeEntry(id);
    setDiary((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearDiary = useCallback(async () => {
    await clearDiaryRows();
    setDiary([]);
  }, []);

  const clearHealthData = useCallback(async () => {
    if (!user) throw userError("Please sign in first.");
    await clearDiaryRows();
    // The weigh-in log is body data like the rest of it, and "delete my health
    // data" that quietly left a year of morning weights behind would be a lie.
    await resetHealthData(user.id, preference);
    await deleteAllWeightLogs(user.id);
    setDiary([]);
    setWeightLogs([]);
    setDayTotals([]);
    setProfileState({ ...DEFAULT_PROFILE, theme: preference });
    setHasProfile(false);
  }, [user, preference]);

  const logWeight = useCallback(
    async (log: WeightLog) => {
      if (!user) throw userError("Please sign in to record your weight.");
      await saveWeightLog(user.id, log);

      // Replace the same day rather than appending: a second weigh-in on one
      // morning is a correction, and two rows would skew that week's average.
      setWeightLogs((current) => {
        const without = current.filter((entry) => entry.date !== log.date);
        return [...without, log].sort((a, b) => a.date.localeCompare(b.date));
      });
    },
    [user],
  );

  /**
   * Maintenance measured rather than predicted, when the data supports it.
   *
   * Recomputed from the loaded weigh-ins and daily totals, and handed to the
   * target calculation so an equation stops being consulted the moment the
   * user's own results can answer the same question better.
   */
  const calibration = useMemo(
    () => calibrateMaintenance(weightLogs, dayTotals, date),
    [weightLogs, dayTotals, date],
  );

  const weightTrend = useMemo(
    () => summariseWeightTrend(weightLogs, date),
    [weightLogs, date],
  );

  const value = useMemo<AppDataValue>(
    () => ({
      profile,
      hasProfile,
      targets: effectiveTargets(profile, calibration?.maintenance),
      calculatedTargets: calculateDailyTargets(profile, calibration?.maintenance),
      weightLogs,
      weightTrend,
      calibration,
      logWeight,
      date,
      setDate,
      diary,
      totals: sumEntries(diary),
      isLoading,
      error,
      saveUserProfile,
      saveTargets,
      logFood,
      removeDiaryEntry,
      clearDiary,
      clearHealthData,
      refresh: loadEverything,
    }),
    [
      profile,
      hasProfile,
      calibration,
      weightLogs,
      weightTrend,
      logWeight,
      date,
      diary,
      isLoading,
      error,
      saveUserProfile,
      saveTargets,
      logFood,
      removeDiaryEntry,
      clearDiary,
      clearHealthData,
      loadEverything,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

/**
 * A freshly minted token can carry an `iat` a second or two ahead of the
 * validating node's clock, which Postgres rejects with "JWT issued at future".
 * It is a race that resolves itself, so it is waited out rather than shown to
 * someone who has just signed up and can do nothing about it.
 */
async function withClockSkewRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const isSkew = /issued at future|jwt.*(not yet valid|iat)/i.test(message);

      if (!isSkew || attempt >= attempts - 1) throw reason;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
}

export function useAppData(): AppDataValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}

export { localDateKey };
