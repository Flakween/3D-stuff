/**
 * Scene settings.
 *
 * Every stage costume is a scene with its own skybox, fog, post effects,
 * lighting and ground settings. The settings are stored alongside the 3D
 * actor data in the project archive and in the local project cache.
 */

import { defaultSceneSettings, normalizeSceneSettings } from "../core/schema.ts";
import { state } from "../state.ts";
import { flushSave } from "../persistence/save.ts";

/** The settings of the scene at `index`. */
export function sceneSettings(index) {
  return state.scenes[index]?.settings || defaultSceneSettings();
}

/**
 * Match the scenes to the stage costumes.
 *
 * The stage's costumes are the source of truth: renaming, adding or removing
 * a costume changes the list of scenes. Settings follow their scene by name.
 */
export function reconcileScenes() {
  const stageTarget = window.vm?.runtime?.getTargetForStage?.();
  const costumes = stageTarget?.getCostumes?.() || [];
  if (!costumes.length) return;

  const old = state.scenes || [];
  if (
    old.length === costumes.length &&
    old.every((item, i) => item.name === costumes[i].name && item.settings)
  ) {
    return;
  }

  const used = new Set();
  const matches = costumes.map((costume) => old.findIndex((item) => item.name === costume.name));
  for (const match of matches) if (match >= 0) used.add(match);

  const next = costumes.map((costume, index) => {
    let match = matches[index];
    if (match < 0 && old[index] && !used.has(index)) match = index;
    if (match >= 0) used.add(match);
    return { name: costume.name, settings: normalizeSceneSettings(old[match]?.settings) };
  });

  if (JSON.stringify(old) !== JSON.stringify(next)) {
    state.scenes = next;
    flushSave();
  }
}
