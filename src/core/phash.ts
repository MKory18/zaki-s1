// بصمة الصورة (pHash 64 بت): تدرّج رمادي ← 32×32 ← DCT ← أول 8×8 مقارنة بالوسيط. المسافة = Hamming.
// صورتين بمسافة 8 أو أقل = نفس المنتج، و15 فأكتر = منفصلين، وبينهم الحَكَم (الإعدادات dedupe.*).
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIM = 8000;

export class ImageError extends Error {}

export interface Decoded {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export function decodeImage(bytes: Uint8Array): Decoded {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageError("الصورة أكبر من 5 ميغا");
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (isPng) {
      const p = PNG.sync.read(Buffer.from(bytes));
      if (p.width > MAX_DIM || p.height > MAX_DIM) throw new ImageError("أبعاد الصورة كبيرة");
      return { width: p.width, height: p.height, data: p.data };
    }
    if (isJpeg) {
      const j = jpeg.decode(Buffer.from(bytes), { useTArray: true, maxMemoryUsageInMB: 256 });
      if (j.width > MAX_DIM || j.height > MAX_DIM) throw new ImageError("أبعاد الصورة كبيرة");
      return { width: j.width, height: j.height, data: j.data };
    }
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("الصورة تالفة");
  }
  throw new ImageError("صيغة الصورة لازم PNG أو JPEG");
}

const N = 32;

function grayResize(img: Decoded): Float64Array {
  const out = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const x0 = Math.floor((x * img.width) / N), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / N));
      const y0 = Math.floor((y * img.height) / N), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / N));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3] / 255; // الشفاف بيعتبر أبيض
          sum += (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a);
          n++;
        }
      }
      out[y * N + x] = sum / n;
    }
  }
  return out;
}

const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));

function dct8(m: Float64Array): number[] {
  const out: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) s += m[y * N + x] * COS[u][x] * COS[v][y];
      out.push(s);
    }
  }
  return out;
}

export function phashOfDecoded(img: Decoded): string {
  const c = dct8(grayResize(img));
  const rest = c.slice(1).sort((a, b) => a - b);
  const median = rest[Math.floor(rest.length / 2)];
  let bits = 0n;
  for (let i = 0; i < 64; i++) bits = (bits << 1n) | (i > 0 && c[i] > median ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export const phash = (bytes: Uint8Array) => phashOfDecoded(decodeImage(bytes));

export function hamming(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new ImageError("بصمة غلط");
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
