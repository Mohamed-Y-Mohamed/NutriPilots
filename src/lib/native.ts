import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();

/**
 * Everything native is dynamically imported and failure-tolerant: the same
 * bundle runs in a browser, where none of these plugins exist.
 */
export async function hideNativeSplash(): Promise<void> {
  if (!isNative) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 260 });
  } catch {
    // Web build, or the plugin is not installed on this platform.
  }
}

export async function applyStatusBarTheme(theme: "light" | "dark"): Promise<void> {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({
      color: theme === "dark" ? "#08120E" : "#F5F7F4",
    });
  } catch {
    // Status bar styling is a nicety, never a blocker.
  }
}

export interface CapturedPhoto {
  blob: Blob;
  previewUrl: string;
}

/**
 * Uses the native camera when available and a file input otherwise. Both paths
 * return the same shape so callers need no platform branch.
 */
export async function capturePhoto(source: "camera" | "gallery"): Promise<CapturedPhoto | null> {
  if (!isNative) return null;

  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    quality: 82,
    width: 1280,
    correctOrientation: true,
    allowEditing: false,
    resultType: CameraResultType.DataUrl,
    source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
  });

  if (!photo.dataUrl) return null;
  const blob = await dataUrlToBlob(photo.dataUrl);
  return { blob, previewUrl: photo.dataUrl };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
