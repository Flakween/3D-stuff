/**
 * Keeps the 3D surfaces in sync with the editor.
 *
 * TurboWarp's editor renders itself with React, so the 3D stage and the model
 * editor are attached to the DOM the editor produced. A mutation observer
 * notices when the stage or the tab panels are replaced and the surfaces are
 * rebuilt.
 */

import { state, runtime } from "../state.ts";
import { actor } from "../runtime/actors.ts";
import {
  getEditor,
  getSceneEditor,
  getStage,
  setEditor,
  setSceneEditor,
  setStage,
} from "../app.ts";
import { installProjectHooks } from "../persistence/project.ts";
import { readyPromise } from "../persistence/storage.ts";
import { Stage3D } from "../renderer/stage.js";
import { ModelEditor } from "../model-editor/model-editor.js";
import { SceneEditor } from "../model-editor/scene-editor.js";
import { updateActorLabels, updateThumbnails } from "../model-editor/thumbnails.js";
import { bindPoseControlVM } from "../model-editor/pose-controls.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let domScheduled = false;
let storageWaitScheduled = false;

export function scheduleSyncDOM() {
  if (domScheduled) return;
  domScheduled = true;
  requestAnimationFrame(syncDOM);
}

export function syncDOM() {
  domScheduled = false;
  const vm = window.vm;
  if (!vm || runtime.projectLoading) return;
  installProjectHooks(vm);
  if (!state.storageKey) {
    if (!storageWaitScheduled) {
      storageWaitScheduled = true;
      readyPromise.finally(() => {
        storageWaitScheduled = false;
        scheduleSyncDOM();
      });
    }
    return;
  }

  const target = vm.editingTarget;
  const stageHost = $('[class*="stage_stage_"]');
  let stage = getStage();
  if (!stageHost && stage) {
    stage.dispose();
    stage = null;
    setStage(null);
  }
  if (
    stageHost &&
    (!stage || stage.host !== stageHost || !stage.canvas.isConnected)
  ) {
    stage?.dispose();
    stage = new Stage3D(stageHost);
    setStage(stage);
  }
  if (stage) {
    stage.bindVM(vm);
    stage.sync();
  }

  const rolePanels = $$('[role="tabpanel"]');
  const roleTabs = $$('[role="tab"]');
  const panels = rolePanels.length ? rolePanels : $$('[class*="gui_tab-panel_"]');
  const tabs = roleTabs.length ? roleTabs : $$('[class*="gui_tab_"]');
  const costumeTab = tabs.find((item) =>
    /costumes?/i.test(`${item.textContent} ${item.getAttribute("aria-label") || ""}`),
  );
  const modelTab = costumeTab || tabs[1];
  const panelIndex = modelTab ? tabs.indexOf(modelTab) : 1;
  const modelPanel =
    document.getElementById(modelTab?.getAttribute("aria-controls")) ||
    panels[panelIndex] ||
    panels[1];
  const visible =
    !!modelTab &&
    (modelTab.getAttribute("aria-selected") === "true" ||
      modelTab.className.includes("is-selected"));
  document.documentElement.classList.toggle("d3-model-open", visible);
  // Earlier revisions injected a second Find box into the tab strip.
  // Remove it if a live editor still has that node.
  document.querySelector(".d3-find-container")?.remove();

  let editor = getEditor();
  if (modelPanel && visible && target && !target.isStage) {
    modelPanel.classList.remove("d3-scene-active");
    modelPanel.classList.add("d3-model-active");
    if (!editor || editor.panel !== modelPanel || !editor.root.isConnected) {
      editor?.dispose();
      editor = new ModelEditor(modelPanel);
      setEditor(editor);
      editor.updateUI();
    } else if (editor.lastTarget !== target.id) {
      state.selected = [];
      editor.refresh();
      editor.updateUI();
    }
    editor.lastTarget = target.id;
    editor.resize();
  } else {
    modelPanel?.classList.remove("d3-model-active");
    if (editor && !editor.root.isConnected) {
      editor.dispose();
      setEditor(null);
    }
  }

  let sceneEditor = getSceneEditor();
  if (modelPanel && visible && target?.isStage) {
    modelPanel.classList.add("d3-scene-active");
    if (!sceneEditor || sceneEditor.panel !== modelPanel || !sceneEditor.root.isConnected) {
      sceneEditor?.dispose();
      sceneEditor = new SceneEditor(modelPanel);
      setSceneEditor(sceneEditor);
    } else sceneEditor.sync();
  } else {
    modelPanel?.classList.remove("d3-scene-active");
    if (sceneEditor && !sceneEditor.root.isConnected) {
      sceneEditor.dispose();
      setSceneEditor(null);
    }
  }

  document.documentElement.classList.toggle("d3-actor-target", !!target && !target.isStage);
  document.documentElement.classList.toggle("d3-stage-target", !!target?.isStage);
  if (target && !target.isStage) {
    actor();
    updateThumbnails();
  }
  bindPoseControlVM(vm);
  updateActorLabels();
}

/** Watch the editor's DOM for the stage and the tab panels. */
export function observeEditorDom() {
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target =
        mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;
      if (target?.closest?.(".d3-editor")) return false;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return (
          node.matches?.(
            '[class*="stage_stage_"],[class*="gui_tab-panel_"],[class*="target-pane_target-pane_"],[class*="sprite-selector-item_sprite-selector-item_"]',
          ) ||
          node.querySelector?.(
            '[class*="stage_stage_"],[class*="gui_tab-panel_"],[class*="target-pane_target-pane_"],[class*="sprite-selector-item_sprite-selector-item_"]',
          )
        );
      });
    });
    if (relevant) scheduleSyncDOM();
  });
  const appRoot = $("#app");
  if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    if (
      event.target?.closest?.(
        '[role="tab"],[class*="sprite-selector-item_sprite-selector-item_"]',
      )
    ) {
      scheduleSyncDOM();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.target?.closest?.(
        '[role="tab"],[class*="sprite-selector-item_sprite-selector-item_"]',
      ) &&
      ["Enter", " "].includes(event.key)
    ) {
      scheduleSyncDOM();
    }
  });
}

/** Wait for the VM to appear, then build the first version of the scene. */
export function waitForVm() {
  const ready = setInterval(() => {
    const vm = window.vm;
    if (!vm?.runtime?.targets?.length) return;
    clearInterval(ready);
    installProjectHooks(vm);
    readyPromise.then(() => {
      if (!runtime.projectLoading) runtime.projectLoadedOnce = true;
      syncDOM();
    });
  }, 100);
}
