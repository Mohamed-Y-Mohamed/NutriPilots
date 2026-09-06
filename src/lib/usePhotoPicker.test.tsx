import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePhotoPicker } from "./usePhotoPicker";

const { nativeState, capturePhotoMock, prepareImageMock } = vi.hoisted(() => ({
  nativeState: { isNative: false },
  capturePhotoMock: vi.fn(),
  prepareImageMock: vi.fn(),
}));

vi.mock("./native", () => ({
  CAMERA_DENIED_MESSAGE: "Camera access is off.",
  capturePhoto: capturePhotoMock,
  get isNative() {
    return nativeState.isNative;
  },
}));

vi.mock("./image", () => ({ prepareImage: prepareImageMock }));

const PHOTO = { blob: new Blob(["x"], { type: "image/jpeg" }), previewUrl: "data:image/jpeg;base64,x" };

function setup() {
  const onPhoto = vi.fn();
  const onError = vi.fn();
  const view = renderHook(() => usePhotoPicker({ onPhoto, onError }));
  return { onPhoto, onError, picker: () => view.result.current };
}

/** A change event carrying one file, as the hidden input would produce. */
function fileChange(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return { target: input } as unknown as React.ChangeEvent<HTMLInputElement>;
}

beforeEach(() => {
  nativeState.isNative = false;
  capturePhotoMock.mockReset();
  prepareImageMock.mockReset().mockResolvedValue(PHOTO);
});

describe("in a browser", () => {
  it("offers no camera, because the web build uploads only", () => {
    const { picker } = setup();
    expect(picker().canTakePhoto).toBe(false);
  });

  it("opens the file picker rather than the camera plugin", async () => {
    const { picker } = setup();
    const input = document.createElement("input");
    const click = vi.spyOn(input, "click");
    Object.defineProperty(picker().fileInputProps.ref, "current", { value: input, writable: true });

    await act(async () => {
      await picker().uploadPhoto();
    });

    expect(click).toHaveBeenCalledOnce();
    expect(capturePhotoMock).not.toHaveBeenCalled();
  });

  it("hands the chosen file over once it is shrunk", async () => {
    const { picker, onPhoto, onError } = setup();
    const input = document.createElement("input");
    const file = new File(["x"], "meal.jpg", { type: "image/jpeg" });

    await act(async () => {
      picker().fileInputProps.onChange(fileChange(input, file));
    });

    expect(prepareImageMock).toHaveBeenCalledWith(file);
    expect(onPhoto).toHaveBeenCalledWith(PHOTO);
    expect(onError).toHaveBeenCalledWith(null);
  });

  it("explains a file it cannot read instead of failing silently", async () => {
    const { picker, onPhoto, onError } = setup();
    prepareImageMock.mockRejectedValue(new Error("boom"));

    await act(async () => {
      picker().fileInputProps.onChange(
        fileChange(document.createElement("input"), new File(["x"], "note.txt")),
      );
    });

    expect(onPhoto).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("Could not read that image"));
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    nativeState.isNative = true;
  });

  it("offers the camera", () => {
    const { picker } = setup();
    expect(picker().canTakePhoto).toBe(true);
  });

  it("takes a photo with the camera", async () => {
    capturePhotoMock.mockResolvedValue({ status: "photo", photo: PHOTO });
    const { picker, onPhoto } = setup();

    await act(async () => {
      await picker().takePhoto();
    });

    expect(capturePhotoMock).toHaveBeenCalledWith("camera");
    expect(onPhoto).toHaveBeenCalledWith(PHOTO);
  });

  it("uploads through the system photo picker, not a file input", async () => {
    capturePhotoMock.mockResolvedValue({ status: "photo", photo: PHOTO });
    const { picker, onPhoto } = setup();

    await act(async () => {
      await picker().uploadPhoto();
    });

    expect(capturePhotoMock).toHaveBeenCalledWith("gallery");
    expect(onPhoto).toHaveBeenCalledWith(PHOTO);
  });

  it("says how to fix a refused camera permission", async () => {
    capturePhotoMock.mockResolvedValue({ status: "denied", message: "Camera access is off." });
    const { picker, onPhoto, onError } = setup();

    await act(async () => {
      await picker().takePhoto();
    });

    expect(onPhoto).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith("Camera access is off.");
  });

  it("stays quiet when the user backs out of the camera", async () => {
    capturePhotoMock.mockResolvedValue({ status: "cancelled" });
    const { picker, onPhoto, onError } = setup();

    await act(async () => {
      await picker().takePhoto();
    });

    expect(onPhoto).not.toHaveBeenCalled();
    // The only call is the one that cleared whatever was on screen beforehand.
    expect(onError).toHaveBeenCalledExactlyOnceWith(null);
  });
});
