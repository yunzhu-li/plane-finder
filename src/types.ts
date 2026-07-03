export type PortalConfig = {
  id: string;
  label: string;
  type: "paperless141";
  proxyBasePath: string;
};

export type PortalCredentials = {
  username: string;
  password: string;
};

export type SearchInput = {
  portalIds: string[];
  credentials: Record<string, PortalCredentials>;
  desiredDate: string;
  startTime: string;
  endTime: string;
  aircraftModel: string;
  cfiName: string;
  requireCfi: boolean;
};

export type StatusLevel = "pending" | "active" | "done" | "error";

export type StatusStep = {
  id: string;
  portalId?: string;
  portalLabel?: string;
  label: string;
  detail?: string;
  level: StatusLevel;
};

export type AircraftSchedule = {
  reg: string;
  type: string;
  cells: ScheduleCell[];
};

export type ScheduleCell = {
  time: string;
  available: boolean;
  label: string;
  title: string;
  rawText: string;
  background: string;
};

export type CfiSchedule = {
  name: string;
  cells: ScheduleCell[];
};

export type Squawk = {
  aircraft: string;
  description: string;
  severity: "low" | "medium" | "high";
};

export type FleetStatus = {
  reg: string;
  model: string;
  squawkCount: number | null;
  tach: number | null;
  hobbs: number | null;
  hundredHourDue: number | null;
  hoursToHundredHour: number | null;
  fiftyHourDue: number | null;
  hoursToFiftyHour: number | null;
  annualDue: string;
  transponderDue: string;
  pitotStaticDue: string;
  eltDue: string;
  adFlag: string;
};

export type Candidate = {
  portalId: string;
  portalLabel: string;
  aircraft: AircraftSchedule;
  score: number;
  viable: boolean;
  reasons: string[];
  requestedMinutes: number;
  availableMinutes: number;
  cfiAvailableMinutes: number | null;
  squawks: Squawk[];
  squawkDetailsLoaded: boolean;
  squawkSkipReason: string | null;
  groundingAlert: boolean;
  inspectionRisk: "unknown" | "low" | "medium" | "high";
  annualOverdue: boolean;
  hundredHourOverdue: boolean;
  estimatedHoursToHundredHour: number | null;
  fleetStatus: FleetStatus | null;
  notes: string[];
};
