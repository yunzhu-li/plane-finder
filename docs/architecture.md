# Plane Finder Architecture

```mermaid
flowchart LR
  user["Flight school member<br/><span>Browser only</span>"]

  subgraph browser["Browser"]
    ui["Preact UI<br/><span>Search form, progress, ranked results</span>"]
    adapter["Paperless141 adapter<br/><span>Login, navigation, parsing</span>"]
    ranking["Ranking engine<br/><span>Availability, squawks, 100hr risk</span>"]
    storage["Encrypted local storage<br/><span>Preferences and credentials</span>"]
  end

  subgraph server["Server"]
    app["Static web server<br/><span>Static files + fixed path proxy</span>"]
  end

  subgraph portals["Supported scheduling portals"]
    nice["Nice Air<br/><span>Paperless141</span>"]
    squadron["Squadron 2<br/><span>Paperless141</span>"]
    advantage["Advantage Aviation<br/><span>Paperless141</span>"]
    aerodynamic["Aerodynamic Aviation<br/><span>Paperless141</span>"]
  end

  subgraph delivery["Delivery"]
    repo["GitHub repo"]
    actions["CI workflow<br/><span>Build and publish image</span>"]
    registry["Container registry<br/><span>Published app image</span>"]
  end

  user --> ui
  ui --> adapter
  adapter --> ranking
  ui <--> storage

  adapter -->|"relative portal/* requests"| app
  app -->|"read-only proxied requests"| nice
  app -->|"read-only proxied requests"| squadron
  app -->|"read-only proxied requests"| advantage
  app -->|"read-only proxied requests"| aerodynamic

  repo --> actions --> registry
  registry -. "app image" .-> app

  classDef person fill:#f8fafc,stroke:#525252,color:#171717,stroke-width:1px;
  classDef browser fill:#f3f4f6,stroke:#737373,color:#171717,stroke-width:1px;
  classDef infra fill:#e5e7eb,stroke:#525252,color:#171717,stroke-width:1px;
  classDef external fill:#fff7ed,stroke:#9a3412,color:#171717,stroke-width:1px;
  classDef delivery fill:#eef2ff,stroke:#4338ca,color:#171717,stroke-width:1px;

  class user person;
  class ui,adapter,ranking,storage browser;
  class app infra;
  class nice,squadron,advantage external;
  class repo,actions,registry delivery;
```

Plane Finder has no application backend. The browser performs the read-only
workflow and ranking logic, while nginx only serves static assets and forwards
fixed portal paths.
