# Roadmap

Where this project is going, and what is in the way.

## Done

* The 4,127 line editor was split into modules with one concern each, and
  the data model moved into TypeScript.
* The 3D blocks are registered as a normal extension with TurboWarp's
  extension manager, instead of being pushed into the VM.
* three.js is bundled at a pinned version. The editor no longer loads code
  from a content delivery network at runtime.
* The data model, the coordinate math and the schema migration are pure and
  unit tested.
* CI lints, type checks, tests and builds, and checks that `dist/` matches
  the sources.
* The deploy workflow uploads a revision without promoting it, and promotes
  in a second, gated run.

## Next

### React components instead of DOM injection

The model editor and the 3D stage are attached to TurboWarp's React tree
from the outside, with a mutation observer. They work, but they are not
first class: the editor can re-render at any time, the panels have to be
re-found, and the 3D surfaces are invisible to the editor's own layout.

The fix is to move the editor back to source (see [FORK.md](FORK.md)) and
then:

* a `<ModelEditorPanel>` component in the costumes tab,
* a `<ThreeDStage>` component that owns the canvas next to the 2D stage,
* the pose fields (x, y, z, yaw, pitch, roll) as real inputs in the sprite
  properties panel,
* the 3D blocks in the toolbox as a real extension rather than through
  `window.dango3dToolbox`.

The engine already has the seams for this. `editor/dom-sync.js` is the only
module that looks at TurboWarp's DOM, and it is small.

### Split the model editor by behaviour

`model-editor/model-editor.js` is 1,285 lines and holds selection, the
gizmo, the material panel, the hierarchy tree, the import and export, and the
undo history. It should become:

* `selection` - what is selected, and what the selection means,
* `transform` - the gizmo, the pivot and the local and world spaces,
* `material` - colour, metallic, smoothness, opacity and the textures,
* `hierarchy` - the tree, parenting and the reordering,
* `history` - undo and redo,
* `import-export` - GLB, glTF and OBJ, and the GLB export.

The undo history is the tricky one: it snapshots the whole actor, so it needs
a structural sharing scheme before the snapshots get expensive.

### First class model assets

Imported models are stored as ordinary project assets, which means they
travel with the project but the VM does not know what they are. A
`scratch-vm` fork could own the model list, validate the hierarchy when a
project loads, and give the blocks proper menus of the models an actor has.

### Multi file glTF and OBJ

The importer accepts a single file. A glTF package with a `.bin` file, an
`.mtl` file and textures has to be resolved as a bundle. That means
extending `importModel` and `loadImportedTemplate` with a file bundle
resolver, and giving the asset store a way to hold several files per model.

### The heading convention

The 3D stage measures the actor heading from the world X axis, which means
direction 90 walks towards +X rather than up the stage. It is consistent
within the 3D engine, and it is what every existing project was made with, so
it was kept. If it is ever changed it needs a migration that rewrites the
saved directions, and the two dimensional stage would have to agree.

### A real test harness

The unit tests cover the data model, and there is a boot test for the
bundle. The parts that need a browser - the stage, the model editor, the
gizmo - are covered by hand only. A headless browser would make the editor
testable, and it is the same work that the React port would need.
