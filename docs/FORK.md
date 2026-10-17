# The fork

The editor in `js/` is TurboWarp's `scratch-gui`, built from commit
[`a2946eeb9a9dca7857d7ab53d766b54288c7a2ff`](https://github.com/TurboWarp/scratch-gui/tree/a2946eeb9a9dca7857d7ab53d766b54288c7a2ff),
with changes. This document lists every change, so the editor can be moved
back to source without losing anything.

TurboWarp's modifications are licensed under GPL-3.0. See [LICENSE](../LICENSE).

## What changed

### 1. The 3D blocks are added to the native categories

The 3D blocks live in the Motion and Looks flyouts, and the 3D extension also
shows up as its own category. The editor asks the engine for the toolbox
entries through `window.dango3dToolbox`, which returns the Motion and Looks
XML with the 3D blocks appended.

* Upstream file: `src/lib/make-toolbox-xml.js`
* Applied by: `node tools/fork-patches.mjs <scratch-gui checkout>`

### 2. The project thumbnail is a frame of the 3D stage

Two places ask the VM's renderer for a snapshot. Both now ask the 3D stage
first, through `window.dango3dStageCapture`, and fall back to the 2D renderer
when there is no 3D stage.

* Upstream file: `src/lib/project-saver-hoc.jsx`, method `getProjectThumbnail`
* Upstream file: `src/lib/tw-restore-point-api.js`, function `generateThumbnail`
* Applied by: `node tools/fork-patches.mjs <scratch-gui checkout>`

TurboWarp's own snapshot API is deliberately *not* redirected. The 3D stage
exposes its own capture interface, so the 2D renderer keeps working for
projects that still need it.

### 3. The project page is not used

The editor serves the editor page only. The project page, the sharing
controls and the navigation to other projects were removed, because the fork
is deployed as a single editor.

### 4. The asset catalog is disabled

The catalog add buttons offer Paint, Upload and Record instead of the
catalog. Catalog loading is switched off and the catalog assets were removed
from the build.

### 5. Most of the bundled illustrations were removed

Nonessential illustrations and thumbnails resolve to a transparent inline SVG
or to the editor's extension button icon. The original files, the app icons
and the micro:bit firmware were removed from the build. The blockly feedback
sounds, the paint tools and the core block media were kept, because active
editor features use them.

### 6. The extension catalog was reduced to the custom extension loader

The built-in extension registry, the compiled extension modules, the online
gallery fetch, the Music samples and the extension block icons were removed.
`static/extensions/` now contains only `example-extension.js`, the custom
extension loader.

A project that uses a removed extension still loads its core blocks, it just
does not try to fetch the extension. Custom extensions still load by URL, by
file and from source code, including URLs that are stored in the project
metadata.

## Moving the editor back to source

The vendored bundle works, but it cannot be merged with upstream, and every
change to the editor has to be made by patching a bundle. The route back:

1. Fork `TurboWarp/scratch-gui`.
2. Run `node tools/fork-patches.mjs <checkout>` to apply the three source
   patches above.
3. Copy `src/` from this repository into the checkout's `src/lib/3d/`.
   The engine has no dependency on the rest of the GUI, apart from the two
   globals and the `window.vm` seam, so it can be moved as it is.
4. Import the engine from the editor's entry point, and let the build bundle
   three.js instead of loading it from a content delivery network.
5. Rebuild the GUI and compare it against `js/`.

Steps 3 to 5 are the ones that turn the DOM injection, the mutation observer
and the string patching into real components. See
[ROADMAP.md](ROADMAP.md).

## Why the engine is not a scratch-vm extension

The 3D blocks *are* a normal extension, and they are registered with
TurboWarp's extension manager. What is not an extension is the stage: it
draws a three.js scene over the Scratch stage, which needs a DOM canvas and
lives in the GUI rather than in the VM.

A `scratch-vm` fork only becomes worth it when the 3D data has to be part of
the project format in a way the VM understands, or when the sensing blocks
have to report 3D values. Until then the project file carries the scene
through the `dango3d` field, which the VM passes through untouched.
