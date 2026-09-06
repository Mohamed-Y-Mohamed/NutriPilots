import { Capacitor } from "@capacitor/core";

import type { PreparedImage } from "./image";

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

export type PhotoSource = "camera" | "gallery";

/**
 * Three outcomes, because a refused permission and a dismissed camera need
 * opposite treatment: one has to be explained before the user tries again, the
 * other is just someone changing their mind and must stay silent.
 */
export type PhotoResult =
  | { status: "photo"; photo: PreparedImage }
  | { status: "cancelled" }
  | { status: "denied"; message: string };

export const CAMERA_DENIED_MESSAGE =
  "NutriPilot needs camera access to take a photo. You can turn it on in " +
  "Settings › Apps › NutriPilot › Permissions, or choose an existing photo instead.";

/**
 * Asks for camera access, and only for camera access.
 *
 * Choosing an existing photo deliberately requests nothing: it goes through the
 * Android photo picker, where selecting an image *is* the grant, and the
 * gallery permissions are stripped from the merged manifest to keep Play's
 * photo policy satisfied. Requesting one here would be denied instantly by a
 * permission the app does not declare, and read to the user as a broken button.
 */
async function grantedCameraAccess(
  camera: typeof import("@capacitor/camera").Camera,
): Promise<boolean> {
  const current = await camera.checkPermissions();
  if (current.camera === "granted" || current.camera === "limited") return true;
  if (current.camera === "denied") return false;

  const asked = await camera.requestPermissions({ permissions: ["camera"] });
  return asked.camera === "granted" || asked.camera === "limited";
}

/**
 * A photo from the native camera or the system photo picker. Returns the same
 * shape as a file the user uploaded, so callers need no platform branch past
 * the point of choosing.
 */
export async function capturePhoto(source: PhotoSource): Promise<PhotoResult> {
  if (!isNative) return { status: "cancelled" };

  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");

  if (source === "camera" && !(await grantedCameraAccess(Camera))) {
    return { status: "denied", message: CAMERA_DENIED_MESSAGE };
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 82,
      width: 1280,
      correctOrientation: true,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
    });

    if (!photo.dataUrl) return { status: "cancelled" };
    const blob = await dataUrlToBlob(photo.dataUrl);
    return { status: "photo", photo: { blob, previewUrl: photo.dataUrl } };
  } catch (reason) {
    // The plugin throws for a dismissed sheet and a refused permission alike,
    // and the only thing telling them apart is the message. Treating an unknown
    // failure as a cancellation is the safe way round: a spurious error message
    // is worse than a button that quietly did nothing the user asked for.
    return refusedAccess(reason)
      ? { status: "denied", message: CAMERA_DENIED_MESSAGE }
      : { status: "cancelled" };
  }
}

function refusedAccess(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return /denied|permission/i.test(message);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
