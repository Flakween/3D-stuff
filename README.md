# Dango Cat

A Scratch-compatible block editor rebuilt around a 3D engine.

The editor is [TurboWarp](https://turbowarp.org)'s `scratch-gui` with a
three.js layer on top: actors are drawn as 3D models on a stage that sits over
the Scratch stage, the costumes tab becomes a model editor, and the Motion
flyout grows blocks that move actors in three dimensions.

```
┌──────────────────────────────────────────────────────────┐
│  TurboWarp editor (vendored build)   │   3D engine      │
│  scratch-gui + scratch-vm + renderer │   src/           │
│                                      │                  │
│  window.vm ──────────────┐           │                  │
│                          ▼           │                  │
│              ┌───────────────────┐   │                  │
│              │  persistence/     │   │                  │
│              │  project hooks    │   │                  │
│              └───────────────────┘   │                  │
└──────────────────────────────────────────────────────────┘
```

## Running it

The editor has to be served over HTTP: it uses module scripts, a service
worker and a WebGL context, none of which work from `file://`.

```bash
npm ci
npm run build      # builds the 3D engine into dist/
npm run serve      # http://localhost:8080
```

`npm start` does both.

```bash
npm run lint       # catches identifiers that were left behind by a refactor
npm run typecheck  # tsc --noEmit over the TypeScript sources
npm test           # unit tests plus a boot test of the built bundle
npm run verify     # all of the above
```

## What is in this repository

| Path         | What it is                                                            |
| ------------ | --------------------------------------------------------------------- |
| `index.html` | The app shell.                                                         |
| `js/`        | TurboWarp's editor bundle, vendored. See [docs/FORK.md](docs/FORK.md). |
| `static/`    | TurboWarp's static assets, vendored.                                   |
| `src/`       | The 3D engine. Everything we wrote lives here.                        |
| `dist/`      | Build output of `src/`. Committed so a clone runs without a build.    |
| `tests/`     | Unit tests for the data model, and a boot test for the bundle.        |
| `tools/`     | Build script, dev server and the boot check.                           |
| `docs/`      | Architecture, the fork guide and the roadmap.                           |

The rule for the repository is simple: **upstream code stays in `js/` and
`static/`, our code stays in `src/`.** Nothing in `src/` edits the vendored
bundle, and nothing in `js/` knows about the 3D engine except through the two
globals listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The 3D engine

`src/` is split by concern, so a change lands in one place:

```
src/
  core/          pure data model, coordinate math, schema migration
  runtime/       VM bridge, runtime settings, per target transforms
  extension/     the 3D blocks and their registration
  renderer/      three.js: scene, primitives, materials, imports, the stage
  model-editor/  the model editor, the scene editor, thumbnails
  persistence/   local cache, asset store, project integration
  ui/            helpers that are not an editor surface
  shell/         small scripts that run before the editor boots
  editor/        attaching the 3D surfaces to TurboWarp's DOM
  state.ts       the shared mutable state
  app.ts         the registry that connects the modules
```

`core/` is pure: no DOM, no three.js, no VM. That is what makes the schema
migration and the coordinate math testable on their own, and it is where the
type definitions live.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the details, including
the coordinate conventions and the known quirks of the current build.

## The 3D blocks

The blocks are a normal TurboWarp extension (`dango3d`) that is registered
with the extension manager, so the palette, the block definitions and the
runtime primitives all come from the same place. The opcodes are unchanged
from the first build of the fork, so existing projects keep working.

* Motion: `move steps in 3D`, `turn`, `point direction`, `go to x/y/z`,
  `glide to x/y/z`, `change/set x/y/z`, `x/y/z position`, `direction`
* Motion: `set/change 3D yaw offset`, `set/change pitch`, `set/change roll`
* Looks: `switch model to`, `model name`

Every distance is in Scratch units, 60 units to a world unit.

## Deploying

`npm run build` produces `dist/`, which is what gets deployed. The
[deploy workflow](.github/workflows/deploy.yml) uploads it to Websim:

1. `workflow_dispatch` with a project id uploads a new revision with
   `websim-cli sync --no-promote`, so it can be tested at its own URL.
2. Running the workflow again with `promote` set makes that revision live.

The workflow needs a `WEBSIM_AUTH_TOKEN` secret. The `production` environment
can be given required reviewers, which turns the deploy into a manual gate.

## Licence

GPL-3.0, inherited from TurboWarp. See [LICENSE](LICENSE).
