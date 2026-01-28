type OrientationResult = {
  url: string;
  revoke?: () => void;
};

const ORIENTATION_CACHE = new Map<
  string,
  { promise: Promise<OrientationResult>; count: number; revoke?: () => void }
>();

const isLikelyJpeg = (url: string) => /\.jpe?g(\?|#|$)/i.test(url);

const readExifOrientation = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  if (view.getUint16(0, false) !== 0xffd8) return null;
  let offset = 2;
  const length = view.byteLength;
  while (offset < length) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      offset += 2;
      if (view.getUint32(offset, false) !== 0x45786966) return null;
      offset += 6;
      const little = view.getUint16(offset, false) === 0x4949;
      const tiffOffset = offset;
      const firstIfdOffset = view.getUint32(offset + 4, little);
      if (!firstIfdOffset) return null;
      let ifdOffset = tiffOffset + firstIfdOffset;
      const entries = view.getUint16(ifdOffset, little);
      for (let i = 0; i < entries; i += 1) {
        const entryOffset = ifdOffset + 2 + i * 12;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          return view.getUint16(entryOffset + 8, little);
        }
      }
      return null;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    offset += view.getUint16(offset, false);
  }
  return null;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

const drawWithOrientation = (
  img: HTMLImageElement,
  orientation: number
): HTMLCanvasElement => {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const swap = orientation >= 5 && orientation <= 8;
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;

  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }

  ctx.drawImage(img, 0, 0);
  return canvas;
};

const fixImageOrientation = async (url: string): Promise<OrientationResult> => {
  if (!url || !isLikelyJpeg(url)) return { url };
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return { url };
    const buffer = await response.arrayBuffer();
    const orientation = readExifOrientation(buffer);
    if (!orientation || orientation === 1) return { url };
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const sourceBlob = new Blob([buffer], { type: contentType });
    const sourceUrl = URL.createObjectURL(sourceBlob);
    const img = await loadImage(sourceUrl);
    URL.revokeObjectURL(sourceUrl);
    const canvas = drawWithOrientation(img, orientation);
    const outputBlob = await canvasToBlob(canvas, contentType, 0.92);
    if (!outputBlob) return { url };
    const outputUrl = URL.createObjectURL(outputBlob);
    return { url: outputUrl, revoke: () => URL.revokeObjectURL(outputUrl) };
  } catch {
    return { url };
  }
};

export const loadOrientedImage = (url: string) => {
  const cached = ORIENTATION_CACHE.get(url);
  if (cached) {
    cached.count += 1;
    return cached.promise;
  }
  const entry = {
    count: 1,
    promise: fixImageOrientation(url).then((result) => {
      entry.revoke = result.revoke;
      return result;
    }),
    revoke: undefined as (() => void) | undefined,
  };
  ORIENTATION_CACHE.set(url, entry);
  return entry.promise;
};

export const releaseOrientedImage = (url: string) => {
  const entry = ORIENTATION_CACHE.get(url);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) {
    entry.revoke?.();
    ORIENTATION_CACHE.delete(url);
  }
};
