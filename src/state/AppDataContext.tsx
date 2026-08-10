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
import { calculateDailyTargets, sumEntries, type DiaryTotals } from "../lib/nutrition";
import { localDateKey } from "../lib/dates";
import {
  addDiaryEntry as addEntry,
  clearDiary as clearDiaryRows,
  loadDiary,
  removeDiaryEntry as removeEntry,
} from "../services/diaryRepository";
import {
  DEFAULT_PROFILE,
  loadProfile,
  resetHealthData,
  saveProfile,
} from "../services/profileRepository";
import type { DailyTargets, DiaryDraft, DiaryEntry, UserProfile } from "../types";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";

interface AppDataValue {
  profile: UserProfile;
  targets: DailyTargets;
  date: string;
  setDate: (date: string) => void;
  diary: DiaryEntry[];
  totals: DiaryTotals;
  isLoading: boolean;
  error: string | null;
  saveUserProfile: (profile: UserProfile) => Promise<void>;
  logFood: (draft: DiaryDraft) => Promise<DiaryEntry>;
  removeDiaryEntry: (id: string) => Promise<void>;
  clearDiary: () => Promise<void>;
  clearHealthData: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();

  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const [date, setDate] = useState(() => localDateKey());
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The theme lives in two places on purpose: localStorage so it applies before
  // the session resolves, and the profile so it follows the user to a new
  // device. This guard stops the two from writing over each other in a loop.
  const themeHydrated = useRef(false);

  const loadEverything = useCallback(async () => {
    if (!user) {
      setProfileState(DEFAULT_PROFILE);
      setDiary([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [loadedProfile, entries] = await Promise.all([loadProfile(), loadDiary(date)]);

      if (loadedProfile) {
        setProfileState(loadedProfile);
        if (!themeHydrated.current) {
          themeHydrated.current = true;
          if (loadedProfile.theme !== preference) setPreference(loadedProfile.theme);
        }
      } else {
        setProfileState({ ...DEFAULT_PROFILE, theme: preference });
      }

      setDiary(entries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your data.");
    } finally {
      setIsLoading(false);
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
      if (!user) throw new Error("Please sign in to save your goals.");
      await saveProfile(user.id, next);
      setProfileState(next);
      themeHydrated.current = true;
    },
    [user],
  );

  const logFood = useCallback(
    async (draft: DiaryDraft) => {
      if (!user) throw new Error("Please sign in to log food.");
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
    if (!user) throw new Error("Please sign in first.");
    await clearDiaryRows();
    await resetHealthData(user.id, preference);
    setDiary([]);
    setProfileState({ ...DEFAULT_PROFILE, theme: preference });
  }, [user, preference]);

  const value = useMemo<AppDataValue>(
    () => ({
      profile,
      targets: calculateDailyTargets(profile),
      date,
      setDate,
      diary,
      totals: sumEntries(diary),
      isLoading,
      error,
      saveUserProfile,
      logFood,
      removeDiaryEntry,
      clearDiary,
      clearHealthData,
      refresh: loadEverything,
    }),
    [
      profile,
      date,
      diary,
      isLoading,
      error,
      saveUserProfile,
      logFood,
      removeDiaryEntry,
      clearDiary,
      clearHealthData,
      loadEverything,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}

export { localDateKey };
