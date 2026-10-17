/**
 * Shared mutable state for the 3D engine.
 *
 * This module deliberately owns data only. Anything that needs to reach the
 * renderer, the editors or the VM goes through `app.ts`, which keeps the
 * dependency graph acyclic and makes the state easy to snapshot in tests.
 */

import type { Actor, ActorMap, Scene } from "./core/types.ts";

export interface EditorState {
  actors: ActorMap;
  scenes: Scene[];
  /** Per target runtime transform overrides, keyed by target id. */
  targetTransforms: Map<string, TransformState>;
  projectId: string | null;
  storageKey: string | null;
  projectSignature: string | null;
  /** Ids of the objects selected in the model editor. */
  selected: string[];
  tool: string;
  transform: string;
  space: string;
  view: string;
  filter: string;
  showHierarchy: boolean;
  boxSelect: boolean;
  exposure: number;
  grid: boolean;
}

export interface TransformState {
  height: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export const state: EditorState = {
  actors: Object.create(null) as ActorMap,
  scenes: [],
  targetTransforms: new Map(),
  projectId: null,
  storageKey: null,
  projectSignature: null,
  selected: [],
  tool: "select",
  transform: "all",
  space: "world",
  view: "rendered",
  filter: "all",
  showHierarchy: true,
  boxSelect: false,
  exposure: 1.25,
  grid: true,
};

/**
 * Counters that decide what has to be rebuilt. They live outside `state` so
 * that a schema migration can replace `state.actors` wholesale without
 * invalidating the bookkeeping.
 */
export const runtime = {
  /** Bumped whenever the whole scene changed. */
  sceneRevision: 0,
  /** Per actor revision, used to skip rebuilding unchanged models. */
  actorRevisions: new Map<string, number>(),
  /** Caches the actor data for a sprite object. */
  actorLookup: new WeakMap<object, { actors: ActorMap; data: Actor }>(),
  /** Clone id to model index. Runtime only, never saved. */
  cloneModels: new Map<string, number>(),
  /** True once a project has been loaded at least once. */
  projectLoadedOnce: false,
  /** True while a project is being loaded, to suppress saves and renders. */
  projectLoading: false,
};

export function bumpActorRevision(actorName: string | null): void {
  if (actorName) {
    runtime.actorRevisions.set(
      actorName,
      (runtime.actorRevisions.get(actorName) || 0) + 1,
    );
  } else {
    runtime.sceneRevision++;
  }
}

export function resetRuntimeBookkeeping(): void {
  runtime.actorRevisions.clear();
  runtime.sceneRevision++;
  runtime.cloneModels.clear();
  state.targetTransforms.clear();
}
