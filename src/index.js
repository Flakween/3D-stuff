/**
 * Entry point of the 3D engine.
 *
 * The engine is a layer on top of TurboWarp's editor. It owns three things:
 * the 3D stage that is drawn over the Scratch stage, the model editor that
 * replaces the costumes tab, and the blocks that move actors in three
 * dimensions.
 *
 * Everything else lives in a module under `src/`, grouped by concern:
 *
 *   core/         pure data model, coordinate math, schema migration
 *   runtime/      VM bridge, runtime settings, per target transforms
 *   extension/    the 3D blocks and their registration
 *   renderer/     three.js scene, primitives, materials, imports, the stage
 *   model-editor/ the model and scene editors
 *   persistence/  local cache, asset store, project integration
 *   ui/           helpers that are not part of an editor surface
 *   shell/        small scripts that run before the editor boots
 */

import { getEditor, getStage, setRenderRequest } from "./app.ts";
import { installToolbox } from "./extension/toolbox.ts";
import { observeEditorDom, scheduleSyncDOM, waitForVm } from "./editor/dom-sync.js";
import { watchVmAssignment } from "./editor/vm-watcher.js";
import { provideScheduleSyncDOM } from "./persistence/project.ts";
import { readyPromise } from "./persistence/storage.ts";

installToolbox();
provideScheduleSyncDOM(scheduleSyncDOM);

let renderPending = false;

/** Ask for a repaint of the stage and, when it is open, of the model editor. */
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    getStage()?.invalidate();
    const editor = getEditor();
    if (editor?.panel.classList.contains("d3-model-active")) editor.render();
  });
}

setRenderRequest(requestRender);

/**
 * The editor asks for a picture of the 3D stage when it builds the thumbnail
 * of a project. TurboWarp's own snapshot API is not redirected to this.
 */
globalThis.dango3dStageCapture = () => {
  try {
    return getStage()?.captureFrame() || null;
  } catch (error) {
    console.warn("Unable to capture the 3D stage", error);
    return null;
  }
};

watchVmAssignment();
observeEditorDom();
waitForVm();

export { readyPromise };
