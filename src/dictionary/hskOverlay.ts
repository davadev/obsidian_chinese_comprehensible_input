export function maxHskLevel(levels: string[]): number {
  let max = 0;
  for (const l of levels) {
    const n = parseInt(l, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}
