import { type ChangeEvent, type RefObject, useRef } from "react";

import { presentError } from "./errors";
import { prepareImage, type PreparedImage } from "./image";
import { capturePhoto, isNative, type PhotoSource } from "./native";

const COULD_NOT_READ = "Could not read that image.";

interface PhotoPickerOptions {
  /** Called once, with a photo already shrunk and ready to send. */
  onPhoto: (photo: PreparedImage) => void | Promise<void>;
  /** A message to show, or null to clear whatever is on screen. */
  onError: (message: string | null) => void;
}

export interface PhotoPicker {
  /** Whether to offer a camera control at all. False in a browser. */
  canTakePhoto: boolean;
  takePhoto: () => Promise<void>;
  uploadPhoto: () => Promise<void>;
  /** Spread onto a visually hidden <input type="file">. */
  fileInputProps: {
    ref: RefObject<HTMLInputElement | null>;
    type: "file";
    accept: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  };
}

/**
 * One way to attach a photo, for the three places that need one.
 *
 * The platforms differ, and deliberately so. A browser only ever uploads a
 * file — no `capture` attribute, because forcing a phone browser straight into
 * its camera takes away the choice of picking an existing photo. A native build
 * offers both: the camera, behind an explicit permission request, and the
 * system photo picker, which needs no permission because choosing a photo in it
 * is the permission.
 */
export function usePhotoPicker({ onPhoto, onError }: PhotoPickerOptions): PhotoPicker {
  const fileRef = useRef<HTMLInputElement>(null);

  // Deliberately not memoised: every caller passes an inline callback, so the
  // dependencies change on every render anyway and a useCallback here would
  // only ever be a wrapper that never holds. These are event handlers, and
  // nothing downstream depends on their identity.
  const deliver = async (photo: PreparedImage) => {
    try {
      await onPhoto(photo);
    } catch (reason) {
      onError(presentError(reason, COULD_NOT_READ));
    }
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onError(null);
    try {
      // Only prepareImage can throw here; deliver reports its own failures.
      const prepared = await prepareImage(file);
      await deliver(prepared);
    } catch (reason) {
      onError(presentError(reason, COULD_NOT_READ));
    } finally {
      // Without this, choosing the same file twice in a row fires no change
      // event the second time and the button looks dead.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const fromNative = async (source: PhotoSource) => {
    onError(null);
    const result = await capturePhoto(source);
    if (result.status === "denied") {
      onError(result.message);
      return;
    }
    if (result.status === "photo") await deliver(result.photo);
  };

  const takePhoto = async () => {
    if (isNative) await fromNative("camera");
  };

  const uploadPhoto = async () => {
    if (isNative) {
      await fromNative("gallery");
      return;
    }
    onError(null);
    fileRef.current?.click();
  };

  return {
    canTakePhoto: isNative,
    takePhoto,
    uploadPhoto,
    fileInputProps: {
      ref: fileRef,
      type: "file",
      accept: "image/*",
      onChange: (event) => void readFile(event),
    },
  };
}
