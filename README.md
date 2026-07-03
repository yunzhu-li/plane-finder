# Plane Finder

Plane Finder is a lightweight read-only scheduling helper for flight school and
flying club members. It searches supported scheduling portals for aircraft that
match a requested time window, checks aircraft status, considers CFI
availability when requested, and ranks the available options.

The current prototype supports Paperless141-style portals:

- Nice Air
- Squadron 2
- Advantage Aviation

## What It Does

- Searches one or more portals in parallel.
- Reuses an authenticated browser session for repeated searches.
- Reads fleet status once per portal login/search flow.
- Treats aircraft missing from fleet status as unavailable.
- Parses the aircraft schedule and CFI columns from the same schedule page.
- Optionally filters aircraft by model text, such as `172`.
- Checks requested-time availability for aircraft and optionally a selected CFI.
- Reads detailed squawks only for aircraft with enough schedule availability.
- Marks aircraft unavailable for current 100-hour overdue, annual overdue, fleet
  maintenance status, or grounding-alert squawks.
- Estimates 100-hour risk at the requested start time using current tach data and
  a simple daily usage estimate for time between now and the requested date.
- Stores portal selection, search inputs, and credentials in browser storage.

## Architecture

Plane Finder has no application backend. It is a static browser application plus
a fixed nginx reverse proxy.

```text
Browser
  Preact UI
  Paperless141 adapter
  HTML form navigation
  schedule/fleet/squawk parsers
  ranking logic
  encrypted local preferences

nginx
  serves static files at /
  proxies fixed portal paths

Paperless141 portals
  upstream scheduling systems
```

The browser owns the application logic:

- Login form submission through the proxy.
- Cookie-backed portal session use.
- Schedule date selection.
- Fleet status, schedule, instructor, and squawk parsing.
- Candidate scoring and display.

The nginx container only serves files and forwards requests to known upstreams.
It is intentionally path based and hard-coded so it does not become a
user-configurable open proxy.

The static frontend is built with relative asset and portal URLs, so it can be
mounted either at `/` or under a reverse-proxied subpath such as
`/aviation/plane-finder/`.

## Proxy Routes

- App: `/`, or a mounted subpath such as `/aviation/plane-finder/`
- Nice Air: `portal/niceair/`
- Squadron 2: `portal/squadron2/`
- Advantage Aviation: `portal/advantage/`

Each route sets the upstream host header, rewrites redirects back to the local
path, and scopes upstream cookies to the matching proxy path.

## Credential Storage

Credentials are stored in the browser after the user runs a search. The app uses
Web Crypto AES-GCM with a non-extractable key stored in IndexedDB and encrypted
credential data stored in localStorage.

This protects against casual inspection of localStorage, but it is still
browser-local storage. JavaScript running in the same application origin can ask
the browser to decrypt the data.

## Safety Model

The prototype is read-only by design. It navigates existing portal pages and
submits forms required to view schedules, fleet status, and squawks. It does not
create reservations, modify schedules, update profiles, or change aircraft
records.

If future work needs a write operation, treat that as a separate feature with an
explicit confirmation flow.

## Development

```sh
pnpm install
pnpm dev
```

Open the Vite dev server URL printed by the command.

Build the production bundle:

```sh
pnpm build
```

## Docker

```sh
docker build -t plane-finder .
docker run --rm -p 8080:8080 plane-finder
```

Open `http://localhost:8080`.

The repository also works with a named local preview container:

```sh
docker build -t plane-finder:dev .
docker run -d --name plane-finder-dev -p 8080:8080 plane-finder:dev
```
