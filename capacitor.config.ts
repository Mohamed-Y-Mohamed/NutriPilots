import type { CapacitorConfig } from "@capacitor/cli";

const SPLASH_GREEN = "#071F18";

const config: CapacitorConfig = {
  appId: "com.nutripilot.app",
  appName: "NutriPilot",
  webDir: "dist",
  android: {
    // Keeps the WebView background dark so there is no white flash between the
    // native splash and the first React paint.
    backgroundColor: SPLASH_GREEN,
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      // The app hides the splash itself once the session has resolved, so the
      // user never sees a half-built screen. `launchAutoHide: false` is what
      // makes that handover possible.
      launchAutoHide: false,
      launchShowDuration: 3000,
      backgroundColor: SPLASH_GREEN,
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: SPLASH_GREEN,
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    Camera: {
      androidxActivityVersion: "1.9.0",
    },
  },
};

export default config;
