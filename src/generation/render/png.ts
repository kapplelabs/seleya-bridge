import { inflateSync } from "node:zlib";

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what Chrome screenshots are) into RGBA pixels.
 * Enough for contrast sampling (research R2); anything else throws.
 */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

export function decodePng(buffer: Buffer): Pixels {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colorType = body[9] ?? 0;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0)
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType})`);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      // x < stride, the length of every row buffer.
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      out[target] = current[x * channels]!;
      out[target + 1] = current[x * channels + 1]!;
      out[target + 2] = current[x * channels + 2]!;
      out[target + 3] = channels === 4 ? current[x * channels + 3]! : 255;
    }
    previous.set(current);
  }
  return { width, height, data: out };
}
