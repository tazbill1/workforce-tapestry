/**
 * Browser-side logo normalisation.
 *
 * Reports print at a fixed header/cover size, so an arbitrary upload (often a 3000px
 * marketing PNG) is scaled down to fit inside a report-friendly box before it ever leaves
 * the browser. The result is a data URL stored on the client row, which keeps the logo
 * available everywhere the report renders — preview, PDF renderer and shared links —
 * without any signed-URL plumbing.
 */

export const LOGO_MAX_W = 600;
export const LOGO_MAX_H = 200;

export async function resizeLogo(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (PNG, JPG or SVG).");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That image could not be decoded."));
    el.src = dataUrl;
  });

  const naturalW = img.naturalWidth || LOGO_MAX_W;
  const naturalH = img.naturalHeight || LOGO_MAX_H;
  const scale = Math.min(LOGO_MAX_W / naturalW, LOGO_MAX_H / naturalH, 1);
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image resizing is not supported in this browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // PNG keeps transparency, which matters for logos dropped onto the white report page.
  const out = canvas.toDataURL("image/png");
  if (out.length > 1_200_000) {
    throw new Error("That logo is too large even after resizing. Try a simpler image.");
  }
  return out;
}
