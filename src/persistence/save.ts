/**
 * Saving and change notification.
 *
 * Every change to the scene goes through `save`. It bumps the revision
 * counters, asks the stage and the model editor to repaint, and schedules a
 * debounced write to the local project cache.
 */

import { getEditor, getStage } from "../app.ts";
import { bumpActorRevision, state } from "../state.ts";
import type { ActorMap } from "../core/types.ts";

export interface SaveOptions {
  /** Tell the VM that the project changed so the UI can offer to save. */
  projectChanged?: boolean;
  /** Ask the 3D stage to rebuild the affected actor. */
  sceneChanged?: boolean;
  /** The actor that changed. */
  actorName?: string | null;
  /** Bump the revision counters. */
  bumpRevision?: boolean;
  /** Record an undo step in the model editor. */
  recordHistory?: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let runtimeSaveTimer: ReturnType<typeof setTimeout> | undefined;
let runtimeSaveMaxTimer: ReturnType<typeof setTimeout> | undefined;
let projectChangeTimer: ReturnType<typeof setTimeout> | undefined;

export const clearSaveTimers = (): void => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  clearTimeout(runtimeSaveTimer);
  runtimeSaveTimer = undefined;
  clearTimeout(runtimeSaveMaxTimer);
  runtimeSaveMaxTimer = undefined;
  clearTimeout(projectChangeTimer);
  projectChangeTimer = undefined;
};

/** Tell the VM that the project changed, without blocking the editor. */
export function scheduleProjectChanged(): void {
  clearTimeout(projectChangeTimer);
  projectChangeTimer = setTimeout(() => {
    const vm = (globalThis as { vm?: { runtime?: { emitProjectChanged?: () => void } } }).vm;
    if (vm?.runtime?.emitProjectChanged) vm.runtime.emitProjectChanged();
  }, 300);
}

/**
 * Record a change. The local cache write is debounced so a drag or a running
 * script cannot starve persistence.
 */
export function save({
  projectChanged = true,
  sceneChanged = false,
  actorName = null,
  bumpRevision = true,
  recordHistory = true,
}: SaveOptions = {}): void {
  if (bumpRevision) bumpActorRevision(actorName);
  if (sceneChanged) getStage()?.markDirty(actorName);
  if (recordHistory) getEditor()?.recordHistory();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    flushSave();
  }, 180);
  if (projectChanged) scheduleProjectChanged();
}

/**
 * Flush the local cache. Runtime transforms use a slower, bounded schedule so
 * continuously changing scripts cannot starve local persistence.
 */
export function scheduleRuntimeSave(): void {
  clearTimeout(runtimeSaveTimer);
  runtimeSaveTimer = setTimeout(() => {
    runtimeSaveTimer = undefined;
    flushSave();
  }, 500);
  if (!runtimeSaveMaxTimer) {
    runtimeSaveMaxTimer = setTimeout(() => {
      runtimeSaveMaxTimer = undefined;
      clearTimeout(runtimeSaveTimer);
      runtimeSaveTimer = undefined;
      flushSave();
    }, 2000);
  }
}

/** Write the current scene to the local project cache. */
export function flushSave(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  clearTimeout(runtimeSaveTimer);
  runtimeSaveTimer = undefined;
  clearTimeout(runtimeSaveMaxTimer);
  runtimeSaveMaxTimer = undefined;
  if (!state.storageKey) return;
  try {
    localStorage.setItem(
      state.storageKey,
      JSON.stringify({
        schemaVersion: 2,
        signature: state.projectSignature,
        actors: actorsByName(),
        scenes: state.scenes,
      }),
    );
  } catch (error) {
    console.warn("Unable to update the local 3D cache", error);
  }
}

/**
 * The actors keyed by name. Every caller serializes immediately; copying
 * through JSON here doubled the work and duplicated embedded texture data
 * during every save and undo.
 */
export function actorsByName(source: ActorMap = state.actors): ActorMap {
  const result = Object.create(null) as ActorMap;
  for (const data of Object.values(source || {})) {
    if (!data?.name) continue;
    result[data.name] = data;
  }
  return result;
}
