// Only alpha==0 is exterior padding. Preserve even barely visible edge pixels.
export function alphaBounds(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
) {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + channels - 1] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  return right < 0
    ? null
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
}
