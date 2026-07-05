// Client-side photo downscaling: any picked image becomes a small data-URL
// thumbnail (webp, jpeg fallback) that fits the server's 200k-char image cap.

const MAX_DATA_URL_CHARS = 195_000;

export async function fileToThumb(file: File, maxDim = 512): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Pick an image file.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image."));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Browsers without webp encode silently return a PNG data-URL — check the prefix.
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const data = canvas.toDataURL(type, quality);
        if (data.startsWith(`data:${type}`) && data.length <= MAX_DATA_URL_CHARS) {
          return data;
        }
      }
    }
    throw new Error("That image is too detailed — try a smaller photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
