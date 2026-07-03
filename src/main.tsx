import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { portals } from "./config";
import { Paperless141Adapter } from "./adapters/paperless141/adapter";
import { loadSearchPreferences, saveSearchPreferences } from "./lib/preferencesStorage";
import type { Candidate, SearchInput, StatusStep } from "./types";
import "./styles.css";

const statusSteps = signal<StatusStep[]>([]);

const today = new Date().toISOString().slice(0, 10);

function App() {
  const [input, setInput] = useState<SearchInput>({
    portalIds: [portals[0].id],
    credentials: Object.fromEntries(portals.map((portal) => [portal.id, { username: "", password: "" }])),
    desiredDate: today,
    startTime: "09:00",
    endTime: "11:00",
    aircraftModel: "",
    cfiName: "",
    requireCfi: false,
  });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const selectedPortals = useMemo(
    () => portals.filter((portal) => input.portalIds.includes(portal.id)),
    [input.portalIds],
  );

  useEffect(() => {
    void loadSearchPreferences()
      .then((saved) => {
        if (saved) setInput((current) => ({ ...current, ...saved, credentials: { ...current.credentials, ...saved.credentials } }));
      })
      .catch(() => {
        updateStatus({ id: "storage", level: "error", label: "Saved preferences unavailable" });
      });
  }, []);

  async function runSearch() {
    setRunning(true);
    setError("");
    setCandidates([]);
    statusSteps.value = [];
    try {
      await saveSearchPreferences(input);
      const portalResults = await Promise.all(selectedPortals.map(async (portal) => {
        const emitPortalStatus = (step: Omit<StatusStep, "id"> & { id?: string }) => {
          const id = step.id || step.label.toLowerCase().replace(/\W+/g, "-");
          updateStatus({
            ...step,
            id: `${portal.id}-${id}`,
            portalId: portal.id,
            portalLabel: portal.label,
            label: step.label || labelFor(id),
          });
        };
        const adapter = new Paperless141Adapter(portal, (step) => {
          emitPortalStatus(step);
        });
        try {
          const result = await adapter.find(input);
          return { portal, candidates: result.candidates, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitPortalStatus({ id: "error", level: "error", label: "Search failed", detail: message });
          return { portal, candidates: [] as Candidate[], error: message };
        }
      }));
      const results = portalResults.flatMap((result) => result.candidates);
      setCandidates(results.sort((a, b) => Number(b.viable) - Number(a.viable) || b.score - a.score));
      const failures = portalResults.filter((result) => result.error);
      if (failures.length === portalResults.length && failures.length > 0) {
        setError(failures.map((result) => `${result.portal.label}: ${result.error}`).join("; "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateStatus({ id: "error", level: "error", label: "Search failed", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main class="shell">
      <section class="topbar">
        <div class="brand">
          <img class="brand-icon" src="icons/plane-finder-page-icon.png" alt="" width="48" height="48" />
          <h1>Plane Finder <span>prototype</span></h1>
          <p class="top-links">
            <a href="https://yunzhu.li/aviation">https://yunzhu.li/aviation</a>
            <a href="https://github.com/yunzhu-li/plane-finder/issues">Feedback</a>
          </p>
        </div>
      </section>

      <section class="workspace">
        <form class="panel search-panel" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <fieldset class="portal-picker">
            <legend>Portals</legend>
            <div class="portal-options">
              {portals.map((portal) => (
                <label class="toggle portal-option" key={portal.id}>
                  <input
                    type="checkbox"
                    name="portalIds"
                    value={portal.id}
                    checked={input.portalIds.includes(portal.id)}
                    onInput={(event) => setInput(togglePortal(input, portal.id, event.currentTarget.checked))}
                  />
                  <span>{portal.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {selectedPortals.map((portal) => (
            <fieldset class="credential-set" key={portal.id}>
              <legend>{portal.label}</legend>
              <div class="grid two">
                <label for={`${portal.id}-username`}>
                  User ID
                  <input
                    id={`${portal.id}-username`}
                    name={`${portal.id}-username`}
                    value={credentialsFor(input, portal.id).username}
                    autocomplete="username"
                    onInput={(event) => setInput(updateCredentials(input, portal.id, { username: event.currentTarget.value }))}
                  />
                </label>
                <label for={`${portal.id}-password`}>
                  Password
                  <input
                    id={`${portal.id}-password`}
                    name={`${portal.id}-password`}
                    type="password"
                    value={credentialsFor(input, portal.id).password}
                    autocomplete="current-password"
                    onInput={(event) => setInput(updateCredentials(input, portal.id, { password: event.currentTarget.value }))}
                  />
                </label>
              </div>
            </fieldset>
          ))}

          <div class="grid three">
            <label>
              Date
              <input type="date" value={input.desiredDate} onInput={(event) => setInput({ ...input, desiredDate: event.currentTarget.value })} />
            </label>
            <label>
              From
              <input type="time" value={input.startTime} onInput={(event) => setInput({ ...input, startTime: event.currentTarget.value })} />
            </label>
            <label>
              To
              <input type="time" value={input.endTime} onInput={(event) => setInput({ ...input, endTime: event.currentTarget.value })} />
            </label>
          </div>

          <label class="toggle">
            <input type="checkbox" checked={input.requireCfi} onInput={(event) => setInput({ ...input, requireCfi: event.currentTarget.checked })} />
            <span>Require CFI availability</span>
          </label>

          <label>
            Aircraft model contains
            <input value={input.aircraftModel} placeholder="Optional, e.g. 172" onInput={(event) => setInput({ ...input, aircraftModel: event.currentTarget.value })} />
          </label>

          <label>
            CFI name contains
            <input value={input.cfiName} placeholder="Optional, e.g. Li" onInput={(event) => setInput({ ...input, cfiName: event.currentTarget.value })} />
          </label>

          <button disabled={running || !canSearch(input)}>{running ? "Searching..." : "Find aircraft"}</button>
          {error && <p class="error">{error}</p>}
        </form>

        <StatusPanel steps={statusSteps.value} />
      </section>

      <Results candidates={candidates} />
    </main>
  );
}

function credentialsFor(input: SearchInput, portalId: string) {
  return input.credentials[portalId] || { username: "", password: "" };
}

function togglePortal(input: SearchInput, portalId: string, selected: boolean): SearchInput {
  const portalIds = selected
    ? [...input.portalIds, portalId]
    : input.portalIds.filter((item) => item !== portalId);
  return {
    ...input,
    portalIds: [...new Set(portalIds)],
  };
}

function updateCredentials(input: SearchInput, portalId: string, next: Partial<{ username: string; password: string }>): SearchInput {
  return {
    ...input,
    credentials: {
      ...input.credentials,
      [portalId]: {
        ...credentialsFor(input, portalId),
        ...next,
      },
    },
  };
}

function canSearch(input: SearchInput): boolean {
  return input.portalIds.length > 0 && input.portalIds.every((portalId) => {
    const credentials = credentialsFor(input, portalId);
    return Boolean(credentials.username && credentials.password);
  });
}

function StatusPanel({ steps }: { steps: StatusStep[] }) {
  const grouped = groupStatusSteps(steps);
  return (
    <aside class="panel">
      <h2>Status</h2>
      {steps.length === 0 && <ul class="steps">
        {steps.length === 0 && <li class="muted">Ready to query the portal.</li>}
      </ul>}
      {grouped.map((group) => (
        <section class="status-group" key={group.key}>
          {group.label && <h3>{group.label}</h3>}
          <ul class="steps">
            {group.steps.map((step) => (
              <li key={step.id} class={step.level}>
                <span>{step.label || labelFor(step.id)}</span>
                {step.detail && <small>{step.detail}</small>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

function groupStatusSteps(steps: StatusStep[]): { key: string; label: string; steps: StatusStep[] }[] {
  const groups: { key: string; label: string; steps: StatusStep[] }[] = [];
  for (const step of steps) {
    const key = step.portalId || "general";
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, label: step.portalLabel || "", steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
  }
  return groups.map((group) => ({
    ...group,
    steps: group.steps.slice(-3),
  }));
}

function Results({ candidates }: { candidates: Candidate[] }) {
  const viable = candidates.filter((candidate) => candidate.viable);
  const nonViable = candidates.filter((candidate) => !candidate.viable);
  return (
    <section class="results">
      <ResultGroup title="Available" candidates={viable} empty="No available aircraft found yet." />
      <ResultGroup title="Unavailable" candidates={nonViable} empty="No unavailable aircraft to show." />
    </section>
  );
}

function ResultGroup({ title, candidates, empty }: { title: string; candidates: Candidate[]; empty: string }) {
  return (
    <section class="panel result-panel">
      <h2>{title}</h2>
      {candidates.length === 0 && <p class="muted">{empty}</p>}
      <div class="cards">
        {candidates.map((candidate) => (
          <article class="candidate" key={`${candidate.portalId}-${candidate.aircraft.reg}`}>
            <header>
              <div>
                <h3>{candidate.aircraft.reg}</h3>
                <p>{candidate.portalLabel} · {candidate.aircraft.type}</p>
              </div>
            </header>
            <div class="facts">
              <Fact
                label="Availability"
                value={coverageValue(candidate.availableMinutes, candidate.requestedMinutes)}
                tone={candidate.availableMinutes >= candidate.requestedMinutes ? "good" : candidate.availableMinutes >= candidate.requestedMinutes / 2 ? "warn" : "bad"}
              />
              {candidate.cfiAvailableMinutes !== null && (
                <Fact
                  label="CFI"
                  value={coverageValue(candidate.cfiAvailableMinutes, candidate.requestedMinutes)}
                  tone={candidate.cfiAvailableMinutes >= candidate.requestedMinutes ? "good" : "bad"}
                />
              )}
              <SquawkFact candidate={candidate} />
              <Fact
                label="Maintenance risk"
                value={candidate.inspectionRisk === "unknown" ? "not found" : candidate.inspectionRisk}
                tone={riskTone(candidate.inspectionRisk)}
              />
              <Fact
                label="Time to 100hr"
                value={candidate.fleetStatus?.hoursToHundredHour == null ? "not listed" : candidate.fleetStatus.hoursToHundredHour.toFixed(1)}
                detail={candidate.estimatedHoursToHundredHour == null || candidate.hundredHourOverdue ? undefined : `Est. at start: ${candidate.estimatedHoursToHundredHour.toFixed(1)}`}
                detailTone={hundredHourTone(candidate.estimatedHoursToHundredHour)}
                tone={hundredHourTone(candidate.fleetStatus?.hoursToHundredHour)}
              />
              {candidate.annualOverdue && candidate.fleetStatus?.annualDue && (
                <Fact
                  label="Annual"
                  value={`${candidate.fleetStatus.annualDue} overdue`}
                  tone="bad"
                />
              )}
            </div>
            {candidate.notes.length > 0 && (
              <div class="notes">
                {candidate.notes.map((note) => <span key={note} class={`note ${noteTone(note)}`}>{note}</span>)}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  detail,
  tone,
  detailTone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone: "good" | "warn" | "bad" | "neutral";
  detailTone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div class="fact">
      <span>{label}</span>
      <span class="fact-value">
        <span class={`value ${tone}`}>{value}</span>
        {detail && <small class={`value ${detailTone}`}>{detail}</small>}
      </span>
    </div>
  );
}

function SquawkFact({ candidate }: { candidate: Candidate }) {
  const count = squawkCount(candidate);
  const tone = count === 0 ? "good" : count <= 2 ? "warn" : "bad";
  return (
    <details class="squawk-toggle">
      <summary class="fact">
        <span>Squawks</span>
        <span class="fact-action">
          <span class={`value ${tone}`}>{count}</span>
          <span class="disclosure" aria-hidden="true">›</span>
        </span>
      </summary>
      <div class="squawk-detail">
        {candidate.squawkDetailsLoaded
          ? (
            candidate.squawks.length > 0
              ? candidate.squawks.map((squawk) => (
                <p key={squawk.description} class={/grounding alert/i.test(squawk.description) ? "bad" : ""}>{squawk.description}</p>
              ))
              : <p class="muted compact">No detailed squawk items found.</p>
          )
          : <p class="muted compact">{candidate.squawkSkipReason || "Squawk details were not queried."}</p>}
      </div>
    </details>
  );
}

function squawkCount(candidate: Candidate): number {
  return candidate.fleetStatus?.squawkCount ?? candidate.squawks.length;
}

function coverageValue(available: number, requested: number): string {
  return available >= requested ? "✓" : `${available}/${requested} min`;
}

function riskTone(risk: Candidate["inspectionRisk"]): "good" | "warn" | "bad" | "neutral" {
  if (risk === "low") return "good";
  if (risk === "medium") return "warn";
  if (risk === "high") return "bad";
  return "neutral";
}

function hundredHourTone(hours: number | null | undefined): "good" | "warn" | "bad" | "neutral" {
  if (hours == null) return "neutral";
  if (hours <= 10) return "bad";
  if (hours <= 25) return "warn";
  return "good";
}

function noteTone(note: string): "good" | "warn" | "bad" | "neutral" {
  if (/overdue|not listed|does not cover|high|grounding alert/i.test(note)) return "bad";
  if (/soon|due during/i.test(note)) return "warn";
  return "neutral";
}

function updateStatus(next: Omit<StatusStep, "id"> & { id?: string }) {
  const id = next.id || next.label.toLowerCase().replace(/\W+/g, "-");
  const existing = statusSteps.value.findIndex((step) => step.id === id);
  const item: StatusStep = {
    id,
    portalId: next.portalId,
    portalLabel: next.portalLabel,
    label: next.label || labelFor(id),
    detail: next.detail,
    level: next.level,
  };
  statusSteps.value = existing >= 0
    ? statusSteps.value.map((step, index) => index === existing ? { ...step, ...item } : step)
    : [...statusSteps.value, item];
}

function labelFor(id: string): string {
  return ({
    session: "Opening portal session",
    login: "Logging in",
    fleet: "Loading fleet status",
    schedule: "Loading aircraft schedule",
    instructors: "Loading instructor schedule",
    squawks: "Loading squawks",
    rank: "Ranking candidates",
  } as Record<string, string>)[id] || id;
}

render(<App />, document.getElementById("app")!);
