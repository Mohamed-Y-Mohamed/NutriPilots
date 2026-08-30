import { userError } from "./errors";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  previewUrl: string;
}

/**
 * Shrinks a photo before it leaves the device. A modern phone camera produces
 * 4–8 MB files; the model gains nothing from that and the user pays for the
 * upload on mobile data.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw userError("Please choose an image file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw userError("That photo is larger than 10 MB. Please choose a smaller one.");
  }

  const dataUrl = await readAsDataUrl(file);
  const image = new Image();
  image.src = dataUrl;

  try {
    await image.decode();
  } catch {
    throw userError("That image could not be opened. Please try another photo.");
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    // No canvas support: send the original rather than failing outright.
    return { blob: file, previewUrl: dataUrl };
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  return { blob, previewUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY) };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}
