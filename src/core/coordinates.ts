/**
 * Scratch <-> world coordinate math.
 *
 * The world is right handed and Y up:
 *   - Scratch X maps to world X.
 *   - Scratch Y maps to world -Z.
 *   - Height maps to world Y.
 *   - An actor faces its local +X, so pitch rotates around local Z and roll
 *     around local X. This is the same forward vector the motion blocks use.
 */

export const SCRATCH_UNITS_PER_WORLD_UNIT = 60;

const DEGREES_TO_RADIANS = Math.PI / 180;

const finiteOr = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export interface PoseInput {
  x?: unknown;
  y?: unknown;
  direction?: unknown;
  size?: unknown;
  visible?: unknown;
}

export interface TransformInput {
  height?: unknown;
  yaw?: unknown;
  pitch?: unknown;
  roll?: unknown;
}

export interface TargetPose {
  x: number;
  y: number;
  direction: number;
  size: number;
  visible: boolean;
  height: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** World space position in world units. */
  position: [number, number, number];
  /** World space rotation in radians, applied in YZX order. */
  rotation: [number, number, number];
  /** Uniform scale derived from the Scratch sprite size. */
  scale: number;
}

/** Convert a TurboWarp target pose into the engine's world pose. */
export function scratchTargetPose(
  target: PoseInput | null | undefined,
  transform: TransformInput = {},
): TargetPose {
  const x = finiteOr(target?.x, 0);
  const y = finiteOr(target?.y, 0);
  const direction = finiteOr(target?.direction, 90);
  const size = finiteOr(target?.size, 100);
  const height = finiteOr(transform.height, 0);
  const yaw = finiteOr(transform.yaw, 0);
  const pitch = finiteOr(transform.pitch, 0);
  const roll = finiteOr(transform.roll, 0);

  return {
    x,
    y,
    direction,
    size,
    visible: target?.visible !== false,
    height,
    yaw,
    pitch,
    roll,
    position: [x / SCRATCH_UNITS_PER_WORLD_UNIT, height, -y / SCRATCH_UNITS_PER_WORLD_UNIT],
    rotation: [
      roll * DEGREES_TO_RADIANS,
      (90 - direction + yaw) * DEGREES_TO_RADIANS,
      pitch * DEGREES_TO_RADIANS,
    ],
    scale: size / 100,
  };
}

export interface Step3D {
  x: number;
  y: number;
  z: number;
}

/** Move `steps` along the actor's forward vector, honouring pitch. */
export function forwardStep3D(
  target: PoseInput | null | undefined,
  transform: TransformInput = {},
  steps: number = 0,
): Step3D {
  const heading =
    (90 - finiteOr(target?.direction, 90) + finiteOr(transform.yaw, 0)) * DEGREES_TO_RADIANS;
  const pitch = finiteOr(transform.pitch, 0) * DEGREES_TO_RADIANS;
  const distance = finiteOr(steps, 0);
  const horizontal = distance * Math.cos(pitch);
  return {
    x: finiteOr(target?.x, 0) + horizontal * Math.cos(heading),
    y: finiteOr(target?.y, 0) + horizontal * Math.sin(heading),
    z:
      finiteOr(transform?.height, 0) * SCRATCH_UNITS_PER_WORLD_UNIT +
      distance * Math.sin(pitch),
  };
}

/** Height of an actor in Scratch units. */
export function heightInScratchUnits(heightInWorldUnits: number): number {
  return finiteOr(heightInWorldUnits, 0) * SCRATCH_UNITS_PER_WORLD_UNIT;
}

/** Normalize a Scratch direction into the -179..179 range the VM uses. */
export function normalizeDirection(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 90;
  return (((number + 179) % 360 + 360) % 360) - 179;
}
