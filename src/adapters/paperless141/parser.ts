import type { AircraftSchedule, CfiSchedule, FleetStatus, ScheduleCell, Squawk } from "../../types";

export function parseHiddenFields(doc: Document): URLSearchParams {
  const params = new URLSearchParams();
  doc.querySelectorAll<HTMLInputElement>("input[type='hidden']").forEach((input) => {
    if (input.name) params.set(input.name, input.value);
  });
  return params;
}

export function parseSchedulePage(html: string): AircraftSchedule[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = findScheduleTable(doc);
  if (!table) return [];

  const rows = [...table.querySelectorAll("tr")];
  const firstTimeRow = firstTimeRowIndex(rows);
  const headerRowIndex = findResourceHeaderRow(rows, firstTimeRow);
  const headerRow = rows[headerRowIndex];
  const typeRow = rows[headerRowIndex + 1];
  const headers = rowCells(headerRow).slice(1);
  const typeCells = isTypeRow(typeRow) ? rowCells(typeRow).slice(1) : [];
  const aircraftEnd = typeCells.findIndex((type) => /CFI|MEI|FI/i.test(type));
  const count = aircraftEnd >= 0 ? aircraftEnd : headers.length;
  const dataStart = firstTimeRow >= 0 ? firstTimeRow : headerRowIndex + 1;

  return headers.slice(0, count).map((reg, colIndex) => ({
    reg,
    type: typeCells[colIndex] || "Unknown",
    cells: rows.slice(dataStart).map((row) => parseScheduleCell(row, colIndex + 1)).filter(Boolean) as ScheduleCell[],
  })).filter((aircraft) => aircraft.reg);
}

export function parseCfiPage(html: string): CfiSchedule[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = findScheduleTable(doc);
  if (!table) return [];

  const rows = [...table.querySelectorAll("tr")];
  const firstTimeRow = firstTimeRowIndex(rows);
  const headerRowIndex = findResourceHeaderRow(rows, firstTimeRow);
  const dataStart = firstTimeRow >= 0 ? firstTimeRow : headerRowIndex + 1;
  const headers = rowCells(rows[headerRowIndex]).slice(1);
  const typeRow = rows[headerRowIndex + 1];
  const typeCells = isTypeRow(typeRow) ? rowCells(typeRow).slice(1) : [];
  const cfiStartRaw = typeCells.findIndex((type) => /CFI|MEI|FI/i.test(type));
  if (typeCells.length > 0 && cfiStartRaw < 0) return [];
  const cfiStart = Math.max(0, cfiStartRaw);

  return headers.slice(cfiStart).map((name, index) => ({
    name,
    cells: rows.slice(dataStart).map((row) => parseScheduleCell(row, cfiStart + index + 1)).filter(Boolean) as ScheduleCell[],
  })).filter((cfi) => cfi.name);
}

export function parseSquawksPage(html: string): Squawk[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const selected = doc.querySelector<HTMLSelectElement>("#ctl00_ContentPlaceHolder1_DropDownList1");
  const aircraft = selected?.selectedOptions[0]?.value || selected?.value || "Unknown";
  const rows = [...doc.querySelectorAll("table tr")];
  const squawks: Squawk[] = [];

  for (const row of rows) {
    const cells = [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent));
    const text = clean(cells.join(" "));
    if (!text || /^Select Aircraft/i.test(text) || /^Reg#|^Date|^Description/i.test(text)) continue;
    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(text)) continue;

    squawks.push({
      aircraft,
      description: text,
      severity: classifySeverity(text),
    });
  }

  return squawks;
}

export function extractAircraftOptions(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll<HTMLOptionElement>("#ctl00_ContentPlaceHolder1_DropDownList1 option")]
    .map((option) => option.value)
    .filter(Boolean);
}

export function parseFleetStatusPage(html: string): FleetStatus[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll<HTMLTableRowElement>("#GridView1 tr")].slice(1);

  return rows.map((row) => {
    const cells = [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent));
    return {
      reg: cells[0] || "",
      model: cells[1] || "",
      squawkCount: parseMaybeNumber(cells[2]),
      tach: parseMaybeNumber(cells[3]),
      hobbs: parseMaybeNumber(cells[4]),
      hundredHourDue: parseMaybeNumber(cells[5]),
      hoursToHundredHour: parseMaybeNumber(cells[6]),
      fiftyHourDue: parseMaybeNumber(cells[7]),
      hoursToFiftyHour: parseMaybeNumber(cells[8]),
      annualDue: cells[11] || "",
      transponderDue: cells[12] || "",
      pitotStaticDue: cells[13] || "",
      eltDue: cells[14] || "",
      adFlag: cells[16] || "",
    };
  }).filter((status) => status.reg);
}

function parseScheduleCell(row: HTMLTableRowElement, colIndex: number): ScheduleCell | null {
  const cells = [...row.querySelectorAll<HTMLTableCellElement>("td, th")];
  const time = clean(cells[0]?.textContent);
  const cell = cells[colIndex];
  if (!/^\d{1,2}:\d{2}$/.test(time) || !cell) return null;

  const rawText = clean(cell.textContent);
  const title = cell.getAttribute("title") || "";
  const background = readStyle(cell.getAttribute("style") || "", "background-color");
  const label = /^select$/i.test(rawText) ? "" : rawText || title;
  const unavailableText = /maint|not available|reserved|standby|ground|inspection|training|unavailable/i.test(`${rawText} ${title}`);
  const available = !unavailableText && (!rawText || /^select$/i.test(rawText));

  return {
    time,
    available,
    label,
    title,
    rawText,
    background,
  };
}

function findScheduleTable(doc: Document): HTMLTableElement | null {
  const exact = doc.querySelector<HTMLTableElement>("#ctl00_ContentPlaceHolder1_GridView2");
  if (exact) return exact;

  const tables = [...doc.querySelectorAll<HTMLTableElement>("table")];
  return tables
    .map((table) => ({
      table,
      score: [...table.querySelectorAll("tr")].reduce((total, row) => {
        const first = rowCells(row)[0] || "";
        if (/^\d{1,2}:\d{2}$/.test(first)) return total + 2;
        if (/Reg#|Reg|Aircraft|Tail|CFI|Instructor/i.test(first)) return total + 1;
        return total;
      }, 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.table || null;
}

function firstTimeRowIndex(rows: HTMLTableRowElement[]): number {
  return rows.findIndex((row) => /^\d{1,2}:\d{2}$/.test(rowCells(row)[0] || ""));
}

function findResourceHeaderRow(rows: HTMLTableRowElement[], firstTimeRow: number): number {
  const searchEnd = firstTimeRow >= 0 ? firstTimeRow : rows.length;
  const candidates = rows.slice(0, searchEnd)
    .map((row, index) => ({ index, cells: rowCells(row) }))
    .filter(({ cells }) => cells.length > 2)
    .filter(({ cells }) => !isTypeLikeLabel(cells[0]) && !isLocationLikeLabel(cells[0]));

  const explicit = candidates.find(({ cells }) => /Reg#|Reg|Aircraft|Tail|CFI|Instructor|Name/i.test(cells[0]));
  if (explicit) return explicit.index;

  return candidates
    .sort((a, b) => resourceHeaderScore(b.cells) - resourceHeaderScore(a.cells))[0]?.index || 0;
}

function resourceHeaderScore(cells: string[]): number {
  return cells.slice(1).reduce((score, cell) => {
    if (!cell) return score;
    if (/^\d{1,2}:\d{2}$/.test(cell)) return score - 2;
    if (/select/i.test(cell)) return score - 2;
    if (/[A-Za-z]/.test(cell) && /\d/.test(cell)) return score + 2;
    if (/[A-Za-z]{2,}/.test(cell)) return score + 1;
    return score;
  }, cells.length);
}

function isTypeRow(row: HTMLTableRowElement | undefined): boolean {
  return isTypeLikeLabel(rowCells(row)[0] || "");
}

function isTypeLikeLabel(value: string): boolean {
  return /^>?Type|Model/i.test(value);
}

function isLocationLikeLabel(value: string): boolean {
  return /^>?Loc|Location/i.test(value);
}

function rowCells(row: HTMLTableRowElement | undefined): string[] {
  return [...row?.querySelectorAll("th, td") ?? []].map((cell) => clean(cell.textContent));
}

function readStyle(style: string, key: string): string {
  return style
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${key}:`))
    ?.split(":")
    .slice(1)
    .join(":")
    .trim() || "";
}

function classifySeverity(text: string): Squawk["severity"] {
  if (/grounding alert|ground|inop|fail|unsafe|flat|leak|engine|brake|maintenance/i.test(text)) return "high";
  if (/rough|intermittent|radio|light|tire|oil/i.test(text)) return "medium";
  return "low";
}

function parseMaybeNumber(value: string): number | null {
  if (!value || /n\/a|not used/i.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}
