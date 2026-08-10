import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { SplashScreen } from "./components/SplashScreen";
import { applyStatusBarTheme, hideNativeSplash } from "./lib/native";
import { AuthPage } from "./pages/AuthPage";
import { CoachPage } from "./pages/CoachPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DiaryPage } from "./pages/DiaryPage";
import { GoalsPage } from "./pages/GoalsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipesPage } from "./pages/RecipesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuth } from "./state/AuthContext";
import { useTheme } from "./state/ThemeContext";

/** Long enough for the logo to register, short enough not to feel like a wait. */
const MINIMUM_SPLASH_MS = 1100;
const FADE_MS = 320;

export function App() {
  const { isLoading, user } = useAuth();
  const { resolved } = useTheme();
  const [splashState, setSplashState] = useState<"visible" | "leaving" | "gone">("visible");

  useEffect(() => {
    void applyStatusBarTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    // The native splash stays up until React has something real to show, so the
    // two never overlap awkwardly.
    if (splashState === "visible") void hideNativeSplash();
  }, [splashState]);

  useEffect(() => {
    if (isLoading || splashState !== "visible") return;

    const elapsedTimer = window.setTimeout(() => setSplashState("leaving"), MINIMUM_SPLASH_MS);
    return () => window.clearTimeout(elapsedTimer);
  }, [isLoading, splashState]);

  useEffect(() => {
    if (splashState !== "leaving") return;
    const timer = window.setTimeout(() => setSplashState("gone"), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [splashState]);

  if (splashState !== "gone") {
    return <SplashScreen leaving={splashState === "leaving"} />;
  }

  // Signing up is the first thing a new person sees, and the only thing an
  // unauthenticated person can reach.
  if (!user) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="diary" element={<DiaryPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
