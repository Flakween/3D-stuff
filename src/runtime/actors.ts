/**
 * Actor lookup and per target runtime transforms.
 *
 * The editor stores a model per actor; the runtime keeps a live transform for
 * every target, including clones. Clones only borrow the model of their
 * original, the choice of model is runtime only.
 */

import {
  MODEL_COORDINATE_LIMIT,
  defaultCone,
  finiteNumber,
  normalizeActor,
  uid,
} from "../core/schema.ts";
import { SCRATCH_UNITS_PER_WORLD_UNIT, normalizeDirection } from "../core/coordinates.ts";
import type { Actor } from "../core/types.ts";
import { runtime, state } from "../state.ts";
import { getStage, schedulePoseControlsSync } from "../app.ts";
import { save, scheduleRuntimeSave } from "../persistence/save.ts";

export interface TargetLike {
  id?: string;
  isStage?: boolean;
  isOriginal?: boolean;
  x?: number;
  y?: number;
  direction?: number;
  size?: number;
  visible?: boolean;
  dragging?: boolean;
  sprite?: { name?: string; clones?: Array<{ id?: string }> };
  runtime?: { requestTargetsUpdate?: (target: TargetLike) => void };
  onTargetMoved?: (target: TargetLike, x: number, y: number, dragging: boolean) => void;
}

/** The saved data of the actor that owns `target`, if there is one. */
export function dataForTarget(target: TargetLike | null | undefined): Actor | null {
  if (!target || target.isStage) return null;
  if (target.id && state.actors[target.id]) return state.actors[target.id] ?? null;
  const originalId = target.sprite?.clones?.[0]?.id;
  if (originalId && state.actors[originalId]) return state.actors[originalId];
  const cached = target.sprite ? runtime.actorLookup.get(target.sprite) : undefined;
  const name = target.sprite?.name;
  if (cached?.actors === state.actors && cached.data.name === name) return cached.data;
  const data = Object.values(state.actors).find((item) => item?.name === name) ?? null;
  if (data && target.sprite) runtime.actorLookup.set(target.sprite, { actors: state.actors, data });
  return data;
}

/** The actor of the currently edited sprite, created on demand. */
export function actor(): Actor | null {
  const vm = (globalThis as { vm?: { editingTarget?: TargetLike; runtime?: { targets?: TargetLike[] } } })
    .vm;
  const target = vm?.editingTarget;
  if (!target || target.isStage) return null;
  if (!target.id) return null;
  if (!state.actors[target.id]) {
    const first =
      (vm?.runtime?.targets || []).filter((t) => !t.isStage && t.isOriginal).length === 1;
    const existing = dataForTarget(target);
    state.actors[target.id] = normalizeActor(
      existing || {
        name: target.sprite?.name,
        models: [
          { id: uid(), name: "model1", objects: first ? [defaultCone()] : [] },
        ],
        active: 0,
      },
      target.sprite?.name || "Actor",
    );
    saveActor(target.id);
  }
  const current = state.actors[target.id];
  if (current.name !== target.sprite?.name) {
    current.name = target.sprite?.name || current.name;
    saveActor(target.id);
  }
  if (!current.transform3D) {
    current.transform3D = { height: 0, yaw: 0, pitch: 0, roll: 0 };
  }
  return current;
}

/**
 * Mark the actor as changed. The save itself is debounced by the persistence
 * layer so a drag cannot starve the local cache.
 */
function saveActor(actorId: string): void {
  const data = state.actors[actorId];
  save({
    projectChanged: false,
    sceneChanged: true,
    actorName: data?.name ?? null,
  });
}

/** The live transform of a target, seeded from the saved actor data. */
export function runtimeTransform(
  target: TargetLike | null | undefined,
  data: Actor | null = dataForTarget(target),
): { height: number; yaw: number; pitch: number; roll: number } {
  if (!target?.id) return { height: 0, yaw: 0, pitch: 0, roll: 0 };
  if (!state.targetTransforms.has(target.id)) {
    state.targetTransforms.set(target.id, {
      height: Number(data?.transform3D?.height) || 0,
      yaw: Number(data?.transform3D?.yaw) || 0,
      pitch: Number(data?.transform3D?.pitch) || 0,
      roll: Number(data?.transform3D?.roll) || 0,
    });
  }
  return state.targetTransforms.get(target.id)!;
}

/** Write one of the 3D transform channels of a target. */
export function setRuntimeTransform(
  target: TargetLike | null | undefined,
  property: "height" | "yaw" | "pitch" | "roll",
  value: unknown,
  change: boolean = false,
): void {
  if (!target || target.isStage) return;
  if (!["height", "yaw", "pitch", "roll"].includes(property)) return;
  const current = runtimeTransform(target);
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  const next = Math.max(
    -MODEL_COORDINATE_LIMIT,
    Math.min(MODEL_COORDINATE_LIMIT, change ? current[property] + number : number),
  );
  if (Object.is(current[property], next)) return;
  current[property] = next;
  if (target.isOriginal) {
    const data = dataForTarget(target);
    if (data) {
      data.transform3D ||= { height: 0, yaw: 0, pitch: 0, roll: 0 };
      data.transform3D[property] = current[property];
      scheduleRuntimeSave();
    }
  }
  getStage()?.invalidate();
  schedulePoseControlsSync();
}

/** Move a target in the Scratch plane without going through the drawable. */
export function setTargetXY3D(target: TargetLike | null | undefined, x: unknown, y: unknown): void {
  if (!target || target.isStage || target.dragging) return;
  const nextX = finiteNumber(x, target.x ?? 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT);
  const nextY = finiteNumber(y, target.y ?? 0, -MODEL_COORDINATE_LIMIT, MODEL_COORDINATE_LIMIT);
  if (nextX === target.x && nextY === target.y) return;
  const oldX = target.x;
  const oldY = target.y;
  target.x = nextX;
  target.y = nextY;
  target.onTargetMoved?.(target, oldX as number, oldY as number, false);
  target.runtime?.requestTargetsUpdate?.(target);
  getStage()?.invalidate();
}

/** Move a target to a Scratch position plus a height in world units. */
export function setPosition3D(
  target: TargetLike | null | undefined,
  x: unknown,
  y: unknown,
  z: unknown,
): void {
  setTargetXY3D(target, x, y);
  setRuntimeTransform(target, "height", Number(z) / SCRATCH_UNITS_PER_WORLD_UNIT);
}

/** The height of a target in Scratch units. */
export function positionZ(target: TargetLike | null | undefined): number {
  return runtimeTransform(target).height * SCRATCH_UNITS_PER_WORLD_UNIT;
}

/** Set the Scratch direction of a target, normalized to the VM's range. */
export function setDirection3D(target: TargetLike | null | undefined, value: unknown): void {
  if (!target || target.isStage) return;
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  const direction = normalizeDirection(number);
  if (target.direction === direction) return;
  target.direction = direction;
  target.runtime?.requestTargetsUpdate?.(target);
  getStage()?.invalidate();
  schedulePoseControlsSync();
}
