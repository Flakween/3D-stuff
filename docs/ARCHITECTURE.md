# Architecture

This document describes how the 3D engine is put together, what the seams
between the modules are, and which of the current behaviours are deliberate.

## The shape of the thing

TurboWarp splits into three packages:

* `scratch-gui` is the interface. It owns the React components, the toolbox
  and the project pages.
* `scratch-vm` runs projects. It owns the compiler, the runtime and the
  extension manager.
* `scratch-render` draws the stage.

This repository is a fork of the *built* `scratch-gui` with a 3D engine
layered on top. The engine is not part of TurboWarp's source tree, so it
reaches the VM through the two seams TurboWarp already exposes:

| Seam                        | Used for                                        |
| --------------------------- | ----------------------------------------------- |
| `window.vm`                 | The VM instance the editor created.             |
| `window.dango3dToolbox`     | Adds the 3D blocks to the Motion and Looks menus. |
| `window.dango3dStageCapture`| Returns a PNG of the 3D stage for the thumbnail. |

`src/persistence/project.ts` is the only module that wraps the VM's
serialization methods, and it does it in one place. Everything else asks it
for data.

## Modules

```
src/
  core/          the data model
    types.ts       the shape of an actor, a model, an object and a scene
    schema.ts      normalization, validation and migration
    coordinates.ts Scratch <-> world math
    hierarchy.ts   model hierarchy validation

  runtime/       the bridge to the VM
    bridge.ts      owns the runtime subscriptions
    settings.ts    stage size, framerate, turbo mode, compiler options
    actors.ts      actor lookup and the per target transforms

  extension/     the blocks
    blocks.ts      the Dango3DExtension class
    register.ts    registration with the extension manager
    toolbox.ts     the Motion and Looks toolbox entries

  renderer/      three.js
    scene.js       the scene, the lights, the ground
    primitives.js  the shapes and their materials
    materials.js   texture overrides
    import.js      GLB, glTF and OBJ loading
    build.js       turns a saved object into a three.js object
    stage.js       the 3D stage that is drawn over the Scratch stage
    textures.js    procedural textures and the environment map
    asset-cache.js the texture and model caches
    dispose.js     releasing GPU resources

  model-editor/  the editors
    model-editor.js  the model workspace
    scene-editor.js  the scene settings
    markup.js        the toolbar and panel markup
    thumbnails.js    the model thumbnails
    pose-controls.js the x/y/z, yaw, pitch and roll fields
    scenes.js        scene settings and their reconciliation

  persistence/   storage
    assets.ts     imported models, in IndexedDB
    save.ts       change notification and the local cache
    storage.ts    reading the cache for the open project
    project.ts    the project file integration

  ui/            helpers that are not an editor surface
    wireframe-overlay.js  the black wire overlay
    mesh-subdivision.js   Loop smoothing and linear refinement

  shell/         scripts that run before the editor boots
    title.js, mobile.js, toolbar-controls.js

  editor/        attaching to TurboWarp's DOM
    dom-sync.js    finds the stage and the tab panels
    vm-watcher.js  installs the hooks on the VM

  state.ts       the shared mutable state
  app.ts         the registry that connects the modules
```

### Import paths

Relative imports name the file extension, and a TypeScript file is imported
with a `.ts` extension:

```js
import { clamp } from "../core/schema.ts";
import { makeScene } from "./scene.js";
```

Node runs the TypeScript sources directly, and it will not rewrite a `.js`
specifier to a `.ts` file, so the extension has to be the real one. esbuild
and `tsc` both understand it as well.

### Why there is a registry

The renderer, the model editor, the scene editor and the persistence layer
need to reach each other, but only at call time. `app.ts` holds the shared
instances and the two callbacks that cross module boundaries
(`requestRender` and `schedulePoseControlsSync`). Without it the module graph
would be a knot of circular imports, and a cycle makes it very hard to see
which module owns what.

### Why `core/` is pure

`core/` does not import the DOM, three.js or the VM. That is what makes the
schema migration and the coordinate math testable without a browser, and it is
the reason `npm test` runs in well under a second. It also means the data
model can be lifted into a `scratch-vm` fork later without dragging the
renderer along.

## The data model

An **actor** is a Scratch sprite. It owns a list of **models** and the index
of the one that is currently shown.

A **model** is a named list of **objects**.

An **object** is one node in the model. It has a transform, a shape, a
material and, optionally, a parent. Objects form a tree.

A **scene** is a stage costume plus the renderer settings that go with it:
skybox, fog, post effects, lighting and ground.

```
project
├─ actors
│  └─ Sprite1
│     ├─ transform3D: { height, yaw, pitch, roll }
│     └─ models
│        └─ model1
│           └─ objects
│              ├─ Cube      { type, position, rotation, scale, material }
│              └─ Imported  { type, source: { format, assetId } }
└─ scenes
   └─ backdrop1
      └─ settings: { skyMode, fog, exposure, shadows, ... }
```

Everything that comes out of a project file passes through `core/schema.ts`.
The normalizers are total: they clamp hostile input, they drop what they
cannot make sense of, and they never throw. A project from another tool, or a
hand edited one, opens.

### Schema versions

* `1` - the format stored inside the project file (`project.dango3d`).
* `2` - the format stored in the local cache.

`migrateProjectScene` in `core/schema.ts` is the single place where an older
payload is brought up to date.

## Coordinates

The world is right handed and Y up.

| Scratch            | World                       |
| ------------------ | --------------------------- |
| X                  | X                           |
| Y                  | -Z                          |
| height             | Y                           |
| 60 Scratch units   | 1 world unit                |

An actor faces its local +X axis. Pitch rotates around the local Z axis, roll
around the local X axis, and the yaw offset around the world Y axis. That is
the same forward vector the motion blocks use, and
`tests/core.test.ts` pins the two against each other.

### The heading is measured from the world X axis

This is worth knowing before touching the motion blocks. In this build the
actor heading is measured so that **direction 90 walks towards +X** and
**direction 0 walks towards +Y**:

```js
const step = forwardStep3D({ x: 0, y: 0, direction: 90 }, {}, 10);
// step.x is 10, step.y is 0
```

Stock Scratch measures the heading the other way round, where direction 90
points up the stage. The 3D stage and the 2D stage therefore disagree about
which way is "up", and since the 3D stage covers the 2D one, only the 3D
convention is visible. This is inherited from the first build of the fork and
was kept as is during the split, because changing it would move every actor
in every existing project. The fix, if it is wanted, is one line in
`core/coordinates.ts` plus a migration that rewrites the saved directions.

## The stage

`renderer/stage.js` draws a scene per stage costume. It reads the target
state and the script ticks through `runtime/bridge.ts`; it never queries the
native canvas and it never patches the native renderer's draw or snapshot
methods. TurboWarp's own renderer and its compiled block engine stay in place
for legacy project behaviour, including 2D sensing and the pen.

The stage is a separate WebGL canvas layered over TurboWarp's stage. It is
transparent to pointer events, so the 2D stage underneath still receives
clicks.

## Persistence

Three stores are involved:

* **local storage** - a copy of the scene, keyed by project id, so a reload
  does not lose work. `persistence/save.ts`.
* **IndexedDB** - the bytes of imported models. `persistence/assets.ts`.
* **the project file** - the scene travels inside the Scratch project under
  the `dango3d` field, and imported models travel as ordinary project assets
  under `dango3d/assets/`.

Runtime transforms are flushed on a bounded delay, so a script that changes
the height of an actor every frame cannot starve the local cache.

## Known rough edges

* The model editor and the 3D stage are attached to TurboWarp's DOM with a
  mutation observer, because the editor is a prebuilt React bundle. A real
  `scratch-gui` fork would make them React components. See
  [ROADMAP.md](ROADMAP.md).
* The model editor is one large class. It is split by file, but not by
  behaviour: selection, the gizmo, the material panel and the hierarchy tree
  still live together in `model-editor/model-editor.js`.
* The scene editor writes straight into `state.scenes`, and the settings are
  only validated when the scene is loaded again.
* Multi file glTF and OBJ packages are not supported. The importer accepts a
  single model file; a bundle resolver would have to extend `importModel` and
  `loadImportedTemplate`.
* The `dist/` folder is committed so that a clone of the repository runs
  without a build step. CI checks that it matches the sources.
