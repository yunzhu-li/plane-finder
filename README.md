# plane-finder

Schedule finder for aircraft fleets.

This prototype is a static Preact app served by nginx. nginx also exposes a
path-based reverse proxy for read-only Paperless141 browsing:

- App: `/`
- Nice Air portal proxy: `/portal/niceair/`

The frontend contains the Paperless141 adapter and performs the login,
navigation, parsing, and ranking in the browser. The proxy is deliberately fixed
to known upstreams; it is not a user-configurable open proxy.

## Development

```sh
pnpm install
pnpm dev
```

## Docker

```sh
docker build -t plane-finder .
docker run --rm -p 8080:8080 plane-finder
```

Open `http://localhost:8080`.
