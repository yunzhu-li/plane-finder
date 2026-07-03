import type {
  AircraftSchedule,
  Candidate,
  CfiSchedule,
  FleetStatus,
  PortalConfig,
  SearchInput,
  Squawk,
  StatusStep,
} from "../../types";
import { overlapMinutes, requestedMinutes } from "../../lib/time";
import {
  extractAircraftOptions,
  parseCfiPage,
  parseFleetStatusPage,
  parseHiddenFields,
  parseSchedulePage,
  parseSquawksPage,
} from "./parser";

type EmitStatus = (step: Omit<StatusStep, "id"> & { id?: string }) => void;

type PortalSession = {
  home: string;
  username: string;
};

const sessions = new Map<string, PortalSession>();

export class Paperless141Adapter {
  constructor(private readonly portal: PortalConfig, private readonly emit: EmitStatus) {}

  async find(input: SearchInput): Promise<{ candidates: Candidate[]; cfiSchedules: CfiSchedule[] }> {
    const home = await this.openSession(input);
    if (!isHomePage(home)) {
      throw new Error("Login did not reach the Paperless141 home page.");
    }

    this.step("fleet", "Loading fleet status", "Reading tach and inspection data");
    const fleetStatus = parseFleetStatusPage(await this.get("/mstr13b.aspx"));
    this.done("fleet", `${fleetStatus.length} fleet status rows parsed`);

    this.step("schedule", "Loading aircraft schedule", "Navigating to resource schedules");
    let scheduleHtml = await this.navigateFromHome(home, "ctl00$BtnSched", "Schedules");
    scheduleHtml = await this.setScheduleDate(scheduleHtml, input.desiredDate, "mstr7p.aspx");
    const aircraft = filterAircraftByModel(parseSchedulePage(scheduleHtml), input.aircraftModel);
    this.done("schedule", `${aircraft.length} aircraft columns parsed`);

    this.step("instructors", "Loading instructor schedule", "Parsing CFI columns from aircraft schedule");
    const cfis = parseCfiPage(scheduleHtml);
    this.done("instructors", `${cfis.length} instructor columns parsed`);

    const requested = requestedMinutes(input.startTime, input.endTime);
    const detailedSquawkTargets = aircraft
      .filter((item) => {
        const status = fleetStatus.find((record) => record.reg === item.reg);
        return status && overlapMinutes(item.cells, input.startTime, input.endTime) >= requested / 2;
      })
      .map((item) => item.reg);

    this.step("squawks", "Loading squawks", "Reading aircraft discrepancy page");
    const squawkHome = await this.navigateFromHome(home, "ctl00$BtnAmtSquawks", "Squawks");
    const squawks = await this.loadSquawksForAircraft(squawkHome, detailedSquawkTargets);

    this.step("rank", "Ranking candidates", "Scoring availability, CFI overlap, and squawks");
    const candidates = rankCandidates(this.portal, input, aircraft, cfis, squawks, fleetStatus, new Set(detailedSquawkTargets));
    this.done("rank", `${candidates.filter((candidate) => candidate.viable).length} available candidates found`);
    return { candidates, cfiSchedules: cfis };
  }

  private async openSession(input: SearchInput): Promise<string> {
    const credentials = input.credentials[this.portal.id];
    if (!credentials?.username || !credentials.password) {
      throw new Error(`Missing credentials for ${this.portal.label}.`);
    }

    const cached = sessions.get(this.portal.id);
    if (cached?.username === credentials.username) {
      this.step("session", "Opening portal session", "Reusing authenticated portal session");
      const home = await this.get("/mstrI.aspx");
      if (isHomePage(home)) {
        this.done("session", "Authenticated session reused");
        this.done("login", "Skipped; already authenticated");
        sessions.set(this.portal.id, { home, username: credentials.username });
        return home;
      }
      sessions.delete(this.portal.id);
    }

    this.step("session", "Opening portal session", "Fetching login page");
    const loginPage = await this.get("/");
    await this.acceptCookies(loginPage);

    this.step("login", "Logging in", "Submitting credentials to proxied portal");
    const home = await this.login(input);
    if (isLoginPage(home)) {
      throw new Error("Login failed; Paperless returned the login page again. Check the saved username and password.");
    }
    if (!isHomePage(home)) {
      throw new Error("Login did not reach the Paperless141 home page.");
    }
    this.done("login", "Authenticated");
    sessions.set(this.portal.id, { home, username: credentials.username });
    return home;
  }

  private async acceptCookies(loginPage: string): Promise<void> {
    if (!/BtnAgree/.test(loginPage)) {
      this.done("session", "Cookie consent was already accepted");
      return;
    }
    const doc = parseHtml(loginPage);
    const params = parseHiddenFields(doc);
    params.set("ScreenWidth", "1440");
    params.set("ScreenHeight", "900");
    params.set("ScreenWidth1", "1440");
    params.set("ScreenHeight1", "900");
    params.set("PixelRatio", "1");
    params.set("BtnAgree", "Accept");
    await this.post("/", params);
    this.done("session", "Portal session is ready");
  }

  private async login(input: SearchInput): Promise<string> {
    const credentials = input.credentials[this.portal.id];
    if (!credentials?.username || !credentials.password) {
      throw new Error(`Missing credentials for ${this.portal.label}.`);
    }

    const page = await this.get("/");
    const doc = parseHtml(page);
    const params = parseHiddenFields(doc);
    params.set("ScreenWidth", "1440");
    params.set("ScreenHeight", "900");
    params.set("ScreenWidth1", "1440");
    params.set("ScreenHeight1", "900");
    params.set("PixelRatio", "1");
    params.set("TextBox1", "Please Log In");
    params.set("txtUserName", credentials.username);
    params.set("txtPassword", credentials.password);
    params.set("ButtLogin", "Log In");
    params.set("ImageButton1.x", "1");
    params.set("ImageButton1.y", "1");
    const response = await this.post("/", params);
    return response;
  }

  private async navigateFromHome(home: string, button: string, value: string): Promise<string> {
    const doc = parseHtml(home);
    const params = parseHiddenFields(doc);
    params.set(button, value);
    return this.post(formPostPath(doc, "mstrI.aspx"), params);
  }

  private async setScheduleDate(html: string, desiredDate: string, path: string): Promise<string> {
    const doc = parseHtml(html);
    const input = doc.querySelector<HTMLInputElement>("#ctl00_ContentPlaceHolder1_DropDate1");
    if (!input) return html;

    const desiredValue = input.type === "date" ? desiredDate : formatPaperlessDate(desiredDate);
    if (input.value === desiredValue) return html;

    const params = collectFormFields(doc);
    params.set("__EVENTTARGET", "ctl00$ContentPlaceHolder1$DropDate1");
    params.set("__EVENTARGUMENT", "");
    params.set("ctl00$ContentPlaceHolder1$DropDate1", desiredValue);
    return this.post(formPostPath(doc, path), params);
  }

  private async loadSquawksForAircraft(squawkHome: string, aircraft: string[]): Promise<Squawk[]> {
    const all: Squawk[] = [];
    const options = extractAircraftOptions(squawkHome);
    const targets = aircraft.filter((reg) => options.includes(reg));

    if (targets.length === 0) {
      this.done("squawks", "No aircraft met detailed squawk threshold");
      return [];
    }

    for (const reg of targets) {
      this.step("squawks", "Loading squawks", `Reading ${reg}`);
      const doc = parseHtml(squawkHome);
      const params = collectFormFields(doc);
      params.set("__EVENTTARGET", "ctl00$ContentPlaceHolder1$DropDownList1");
      params.set("__EVENTARGUMENT", "");
      params.set("ctl00$ContentPlaceHolder1$DropDownList1", reg);
      const html = await this.post("/mstr4.aspx", params);
      all.push(...parseSquawksPage(html).map((squawk) => ({ ...squawk, aircraft: reg })));
    }

    this.done("squawks", `${all.length} squawk-like rows found`);
    return all;
  }

  private async get(path: string): Promise<string> {
    const response = await fetch(portalUrl(this.portal, path), {
      credentials: "include",
    });
    return this.read(response);
  }

  private async post(path: string, body: URLSearchParams): Promise<string> {
    const response = await fetch(portalUrl(this.portal, path), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "follow",
    });
    return this.read(response);
  }

  private async read(response: Response): Promise<string> {
    if (!response.ok) throw new Error(`Portal returned ${response.status}`);
    return response.text();
  }

  private step(id: string, label: string, detail?: string): void {
    this.emit({ id, level: "active", label, detail });
  }

  private done(id: string, detail?: string): void {
    this.emit({ id, level: "done", label: "", detail });
  }
}

function portalUrl(portal: PortalConfig, path: string): string {
  const base = portal.proxyBasePath.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return suffix ? `${base}/${suffix}` : `${base}/`;
}

function isHomePage(html: string): boolean {
  return /mstrI\.aspx|Announcements|ctl00_BtnSched/.test(html);
}

function isLoginPage(html: string): boolean {
  return /txtUserName|txtPassword|ImageButton1|ButtLogin/.test(html);
}

function rankCandidates(
  portal: PortalConfig,
  input: SearchInput,
  aircraft: AircraftSchedule[],
  cfis: CfiSchedule[],
  squawks: Squawk[],
  fleetStatus: FleetStatus[],
  detailedSquawkRegs: Set<string>,
): Candidate[] {
  const requested = requestedMinutes(input.startTime, input.endTime);
  const selectedCfi = cfis.find((cfi) => cfi.name.toLowerCase().includes(input.cfiName.toLowerCase()));

  return aircraft
    .map((item) => {
      const status = fleetStatus.find((record) => record.reg === item.reg) || null;
      const squawkDetailsLoaded = detailedSquawkRegs.has(item.reg);
      const aircraftSquawks = squawks.filter((squawk) => squawk.aircraft === item.reg);
      const availableMinutes = overlapMinutes(item.cells, input.startTime, input.endTime);
      const cfiAvailableMinutes = input.requireCfi && selectedCfi
        ? overlapMinutes(selectedCfi.cells, input.startTime, input.endTime)
        : null;
      const fleetSquawkCount = status?.squawkCount ?? 0;
      const squawkPenalty = aircraftSquawks.reduce((total, squawk) => {
        if (squawk.severity === "high") return total + 35;
        if (squawk.severity === "medium") return total + 15;
        return total + 5;
      }, Math.max(0, fleetSquawkCount - aircraftSquawks.length) * 5);
      const availabilityScore = requested > 0 ? (availableMinutes / requested) * 100 : 0;
      const cfiScore = input.requireCfi ? (cfiAvailableMinutes ?? 0) / requested * 25 : 25;
      const estimatedHoursToHundredHour = estimateHoursToHundredAtStart(status, input.desiredDate);
      const annualOverdue = Boolean(status?.annualDue && isOverdueAt(status.annualDue, input.desiredDate));
      const hundredHourOverdue = Boolean(status?.hoursToHundredHour != null && status.hoursToHundredHour <= 0);
      const groundingAlert = aircraftSquawks.some((squawk) => /grounding alert/i.test(squawk.description));
      const inspectionRisk = estimateInspectionRisk(item, status, requested / 60, annualOverdue, estimatedHoursToHundredHour);
      const inspectionPenalty = inspectionPenaltyFor(inspectionRisk, status, annualOverdue, estimatedHoursToHundredHour);
      const inspectionBonus = status?.hoursToHundredHour == null ? 0 : Math.min(20, Math.max(0, status.hoursToHundredHour / 5));
      const blockedByMaintenance = annualOverdue || hundredHourOverdue || groundingAlert;
      const viable = Boolean(status) && !blockedByMaintenance && availableMinutes >= requested && (!input.requireCfi || (cfiAvailableMinutes ?? 0) >= requested);
      const squawkSkipReason = squawkDetailsLoaded ? null : "Squawk details skipped because availability is below half of the requested window.";
      const reasons = buildReasons(requested, availableMinutes, cfiAvailableMinutes, aircraftSquawks, inspectionRisk, input.requireCfi, status, squawkDetailsLoaded, annualOverdue);
      const notes = buildNotes(requested, availableMinutes, cfiAvailableMinutes, input.requireCfi, status, annualOverdue, hundredHourOverdue, groundingAlert);

      return {
        portalId: portal.id,
        portalLabel: portal.label,
        aircraft: item,
        score: Math.round(availabilityScore + cfiScore + inspectionBonus - squawkPenalty - inspectionPenalty - (status ? 0 : 100)),
        viable,
        reasons,
        requestedMinutes: requested,
        availableMinutes,
        cfiAvailableMinutes,
        squawks: aircraftSquawks,
        squawkDetailsLoaded,
        squawkSkipReason,
        groundingAlert,
        inspectionRisk,
        annualOverdue,
        hundredHourOverdue,
        estimatedHoursToHundredHour,
        fleetStatus: status,
        notes,
      };
    })
    .sort((a, b) => Number(b.viable) - Number(a.viable) || b.score - a.score);
}

function filterAircraftByModel(aircraft: AircraftSchedule[], modelFilter: string): AircraftSchedule[] {
  const filter = modelFilter.trim().toLowerCase();
  if (!filter) return aircraft;
  return aircraft.filter((item) => item.type.toLowerCase().includes(filter));
}

function buildReasons(
  requested: number,
  available: number,
  cfiAvailable: number | null,
  squawks: Squawk[],
  inspectionRisk: Candidate["inspectionRisk"],
  requireCfi: boolean,
  fleetStatus: FleetStatus | null,
  squawkDetailsLoaded: boolean,
  annualOverdue: boolean,
): string[] {
  const reasons: string[] = [];
  if (available < requested) reasons.push(`Aircraft available for ${available}/${requested} min`);
  else reasons.push("Aircraft covers requested time");
  if (requireCfi) {
    if (cfiAvailable === null) reasons.push("Selected CFI was not found");
    else if (cfiAvailable < requested) reasons.push(`CFI available for ${cfiAvailable}/${requested} min`);
    else reasons.push("CFI covers requested time");
  }
  if (!squawkDetailsLoaded) reasons.push("Squawk detail skipped; below half requested availability");
  else if (squawks.length) reasons.push(`${squawks.length} squawk-like item(s)`);
  else reasons.push("No parsed squawk items");
  reasons.push(...inspectionReasons(inspectionRisk, fleetStatus, annualOverdue));
  return reasons;
}

function buildNotes(
  requested: number,
  available: number,
  cfiAvailable: number | null,
  requireCfi: boolean,
  status: FleetStatus | null,
  annualOverdue: boolean,
  hundredHourOverdue: boolean,
  groundingAlert: boolean,
): string[] {
  const notes: string[] = [];
  if (!status) notes.push("Not listed in fleet status page");
  if (available < requested) notes.push("Does not cover requested time");
  if (requireCfi && (cfiAvailable ?? 0) < requested) notes.push("CFI does not cover requested time");
  if (hundredHourOverdue) notes.push("100hr overdue");
  else if (status?.hoursToHundredHour != null && status.hoursToHundredHour <= requested / 60) notes.push("100hr due during requested booking");
  else if (status?.hoursToHundredHour != null && status.hoursToHundredHour <= 10) notes.push("100hr due soon");
  if (annualOverdue) notes.push("Annual overdue");
  if (groundingAlert) notes.push("Grounding alert");
  return [...new Set(notes)];
}

function estimateInspectionRisk(
  aircraft: AircraftSchedule,
  fleetStatus: FleetStatus | null,
  requestedHours: number,
  annualOverdue: boolean,
  estimatedHoursToHundredHour: number | null,
): Candidate["inspectionRisk"] {
  if (fleetStatus) {
    const hoursToHundred = estimatedHoursToHundredHour ?? fleetStatus.hoursToHundredHour;
    if (hoursToHundred != null && hoursToHundred <= requestedHours) return "high";
    if (annualOverdue) return "high";
    if (hoursToHundred != null && hoursToHundred <= 10) return "medium";
    if (hoursToHundred != null || fleetStatus.annualDue) return "low";
  }

  const text = aircraft.cells.map((cell) => `${cell.rawText} ${cell.title}`).join(" ");
  if (/100\s*hr|annual|inspection|maint/i.test(text)) return "high";
  if (/maint|ground/i.test(text)) return "medium";
  return "unknown";
}

function estimateHoursToHundredAtStart(status: FleetStatus | null, desiredDate: string): number | null {
  if (status?.hoursToHundredHour == null) return null;
  const daysUntilRequestedDate = daysBetweenLocalDates(todayLocalDate(), desiredDate);
  return status.hoursToHundredHour - daysUntilRequestedDate * 4;
}

function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetweenLocalDates(startDate: string, endDate: string): number {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function inspectionPenaltyFor(
  risk: Candidate["inspectionRisk"],
  fleetStatus: FleetStatus | null,
  annualOverdue: boolean,
  estimatedHoursToHundredHour: number | null,
): number {
  const hoursToHundred = estimatedHoursToHundredHour ?? fleetStatus?.hoursToHundredHour;
  const hundredHourPenalty = hoursToHundred == null
    ? 0
    : Math.max(0, 25 - hoursToHundred);
  const annualPenalty = annualOverdue ? 30 : 0;
  const riskPenalty = risk === "high" ? 30 : risk === "medium" ? 12 : 0;
  return Math.max(riskPenalty, hundredHourPenalty + annualPenalty);
}

function inspectionReasons(risk: Candidate["inspectionRisk"], status: FleetStatus | null, annualOverdue: boolean): string[] {
  if (!status) return ["Not listed in fleet status page"];
  const reasons = [
    status.hoursToHundredHour == null
      ? "100hr: not listed"
      : `100hr: ${status.hoursToHundredHour.toFixed(1)} remaining`,
  ];
  if (annualOverdue) reasons.push(`Annual overdue: ${status.annualDue}`);
  reasons.push(`Inspection risk: ${risk}`);
  return reasons;
}

function isOverdueAt(value: string, requestedDate: string): boolean {
  const due = parseMonthYear(value);
  if (!due) return false;
  const requested = new Date(`${requestedDate}T23:59:59`);
  return due.getTime() < requested.getTime();
}

function parseMonthYear(value: string): Date | null {
  const match = value.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  const year = 2000 + Number(match[2]);
  return new Date(year, month + 1, 0, 23, 59, 59);
}

function collectFormFields(doc: Document): URLSearchParams {
  const params = parseHiddenFields(doc);
  doc.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((field) => {
    if (!field.name || field instanceof HTMLInputElement && ["submit", "image", "button"].includes(field.type)) return;
    if (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) && !field.checked) return;
    params.set(field.name, field.value);
  });
  return params;
}

function formPostPath(doc: Document, fallback: string): string {
  const action = doc.querySelector<HTMLFormElement>("form")?.getAttribute("action") || "";
  if (!action || action === "./") return `/${fallback}`;
  try {
    const parsed = new URL(action, "https://portal.local/");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return action.startsWith("/") ? action : `/${action}`;
  }
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function formatPaperlessDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
