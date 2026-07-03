export function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function overlapMinutes(
  cells: { time: string; available: boolean }[],
  start: string,
  end: string,
): number {
  const startMin = minutesFromTime(start);
  const endMin = minutesFromTime(end);
  const slot = inferSlotMinutes(cells.map((cell) => cell.time));
  return cells.reduce((total, cell) => {
    const t = minutesFromTime(cell.time);
    if (cell.available && t >= startMin && t < endMin) {
      return total + slot;
    }
    return total;
  }, 0);
}

export function inferSlotMinutes(times: string[]): number {
  const parsed = times.map(minutesFromTime).sort((a, b) => a - b);
  for (let index = 1; index < parsed.length; index += 1) {
    const diff = parsed[index] - parsed[index - 1];
    if (diff > 0) return diff;
  }
  return 30;
}

export function requestedMinutes(start: string, end: string): number {
  return Math.max(0, minutesFromTime(end) - minutesFromTime(start));
}
