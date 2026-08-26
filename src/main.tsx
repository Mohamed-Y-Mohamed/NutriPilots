import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./state/AuthContext";
import { AppDataProvider } from "./state/AppDataContext";
import { ThemeProvider } from "./state/ThemeContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      Outside every provider on purpose. AuthProvider and AppDataProvider both
      talk to Supabase during render, so they are among the things most likely
      to throw — a boundary nested inside them could not catch that.
    */}
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppDataProvider>
              <App />
            </AppDataProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
