/**
 * The 3D block set.
 *
 * The opcodes are the ones the existing projects already use, so old
 * projects keep working. What changed is how the extension is registered:
 * it is a normal extension that TurboWarp's extension manager loads, instead
 * of a class that is pushed into the VM from the outside.
 */

import { SCRATCH_UNITS_PER_WORLD_UNIT, forwardStep3D } from "../core/coordinates.ts";
import {
  dataForTarget,
  positionZ,
  runtimeTransform,
  setDirection3D,
  setPosition3D,
  setRuntimeTransform,
  setTargetXY3D,
} from "../runtime/actors.ts";
import type { TargetLike } from "../runtime/actors.ts";
import { runtime, state } from "../state.ts";
import { getEditor, getStage } from "../app.ts";
import { save } from "../persistence/save.ts";
import { updateThumbnails } from "../model-editor/thumbnails.js";

export type ExtensionTarget = TargetLike;

export interface ExtensionUtil {
  target?: ExtensionTarget;
  stackFrame?: Record<string, unknown>;
  yield?: () => void;
  [key: string]: unknown;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  color1: string;
  color2: string;
  color3: string;
  targetTypes?: string[];
  blocks: Array<Record<string, unknown>>;
}

/** The blocks this extension contributes. */
export function extensionInfo(): ExtensionInfo {
  return {
    id: "dango3d",
    name: "3D",
    color1: "#4c97ff",
    color2: "#4280d7",
    color3: "#3373cc",
    targetTypes: ["sprite"],
    blocks: [
      {
        opcode: "moveSteps3D",
        blockType: "command",
        text: "move [STEPS] steps in 3D",
        arguments: { STEPS: { type: "number", defaultValue: 10 } },
      },
      {
        opcode: "turnRight3D",
        blockType: "command",
        text: "turn right [DEGREES] degrees",
        arguments: { DEGREES: { type: "number", defaultValue: 15 } },
      },
      {
        opcode: "turnLeft3D",
        blockType: "command",
        text: "turn left [DEGREES] degrees",
        arguments: { DEGREES: { type: "number", defaultValue: 15 } },
      },
      {
        opcode: "pointDirection3D",
        blockType: "command",
        text: "point direction [DIRECTION] pitch [PITCH]",
        arguments: {
          DIRECTION: { type: "number", defaultValue: 90 },
          PITCH: { type: "number", defaultValue: 0 },
        },
      },
      {
        opcode: "goToPosition3D",
        blockType: "command",
        text: "go to x: [X] y: [Y] z: [Z]",
        arguments: {
          X: { type: "number", defaultValue: 0 },
          Y: { type: "number", defaultValue: 0 },
          Z: { type: "number", defaultValue: 0 },
        },
      },
      {
        opcode: "glideToPosition3D",
        blockType: "command",
        text: "glide [SECS] secs to x: [X] y: [Y] z: [Z]",
        arguments: {
          SECS: { type: "number", defaultValue: 1 },
          X: { type: "number", defaultValue: 0 },
          Y: { type: "number", defaultValue: 0 },
          Z: { type: "number", defaultValue: 0 },
        },
      },
      ...(["X", "Y", "Z"] as const).flatMap((axis) => [
        {
          opcode: `change${axis}3D`,
          blockType: "command",
          text: `change ${axis.toLowerCase()} by [DELTA]`,
          arguments: { DELTA: { type: "number", defaultValue: 10 } },
        },
        {
          opcode: `set${axis}3D`,
          blockType: "command",
          text: `set ${axis.toLowerCase()} to [VALUE]`,
          arguments: { VALUE: { type: "number", defaultValue: 0 } },
        },
        {
          opcode: `${axis.toLowerCase()}Position3D`,
          blockType: "reporter",
          text: `${axis.toLowerCase()} position`,
        },
      ]),
      { opcode: "direction3D", blockType: "reporter", text: "direction" },
      {
        opcode: "gotoXYZ",
        blockType: "command",
        text: "go to x: [X] y: [Y] height: [HEIGHT]",
        arguments: {
          X: { type: "number", defaultValue: 0 },
          Y: { type: "number", defaultValue: 0 },
          HEIGHT: { type: "number", defaultValue: 0 },
        },
      },
      {
        opcode: "setHeight",
        blockType: "command",
        text: "set height to [HEIGHT]",
        arguments: { HEIGHT: { type: "number", defaultValue: 0 } },
      },
      {
        opcode: "changeHeight",
        blockType: "command",
        text: "change height by [DELTA]",
        arguments: { DELTA: { type: "number", defaultValue: 1 } },
      },
      { opcode: "height", blockType: "reporter", text: "height" },
      {
        opcode: "setYaw",
        blockType: "command",
        text: "set 3D yaw offset to [ANGLE] degrees",
        arguments: { ANGLE: { type: "number", defaultValue: 0 } },
      },
      {
        opcode: "changeYaw",
        blockType: "command",
        text: "change 3D yaw offset by [DELTA] degrees",
        arguments: { DELTA: { type: "number", defaultValue: 15 } },
      },
      { opcode: "yaw", blockType: "reporter", text: "3D yaw offset" },
      {
        opcode: "setPitch",
        blockType: "command",
        text: "set pitch to [ANGLE] degrees",
        arguments: { ANGLE: { type: "number", defaultValue: 0 } },
      },
      {
        opcode: "changePitch",
        blockType: "command",
        text: "change pitch by [DELTA] degrees",
        arguments: { DELTA: { type: "number", defaultValue: 15 } },
      },
      { opcode: "pitch", blockType: "reporter", text: "3D pitch" },
      {
        opcode: "setRoll",
        blockType: "command",
        text: "set roll to [ANGLE] degrees",
        arguments: { ANGLE: { type: "number", defaultValue: 0 } },
      },
      {
        opcode: "changeRoll",
        blockType: "command",
        text: "change roll by [DELTA] degrees",
        arguments: { DELTA: { type: "number", defaultValue: 15 } },
      },
      { opcode: "roll", blockType: "reporter", text: "3D roll" },
      {
        opcode: "selectModel",
        blockType: "command",
        text: "switch model to [MODEL]",
        arguments: { MODEL: { type: "string", defaultValue: "model1" } },
      },
      { opcode: "modelName", blockType: "reporter", text: "model name" },
    ],
  };
}

export class Dango3DExtension {
  private runtime: unknown;

  constructor(runtime: unknown) {
    this.runtime = runtime;
  }

  getInfo(): ExtensionInfo {
    return extensionInfo();
  }

  moveSteps3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    const target = util.target;
    if (!target || target.isStage) return;
    const next = forwardStep3D(target, runtimeTransform(target), Number(args.STEPS));
    setPosition3D(target, next.x, next.y, next.z);
  }

  turnRight3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setDirection3D(util.target, Number(util.target?.direction ?? 90) + Number(args.DEGREES));
  }

  turnLeft3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setDirection3D(util.target, Number(util.target?.direction ?? 90) - Number(args.DEGREES));
  }

  pointDirection3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setDirection3D(util.target, args.DIRECTION);
    setRuntimeTransform(util.target, "pitch", args.PITCH);
  }

  goToPosition3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setPosition3D(util.target, args.X, args.Y, args.Z);
  }

  glideToPosition3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    const target = util.target;
    if (!target || target.isStage) return;
    const frame = util.stackFrame as Record<string, unknown>;
    if (!frame.dango3dGlide) {
      const seconds = Math.max(0, Number(args.SECS) || 0);
      frame.dango3dGlide = {
        start: performance.now(),
        duration: seconds * 1000,
        from: [target.x, target.y, positionZ(target)],
        to: [Number(args.X), Number(args.Y), Number(args.Z)],
      };
    }
    const glide = frame.dango3dGlide as {
      start: number;
      duration: number;
      from: number[];
      to: number[];
    };
    const fraction = glide.duration
      ? Math.min(1, (performance.now() - glide.start) / glide.duration)
      : 1;
    setPosition3D(
      target,
      ...(glide.from.map((value, index) => value + (glide.to[index] - value) * fraction) as [
        number,
        number,
        number,
      ]),
    );
    if (fraction < 1) util.yield?.();
    else delete frame.dango3dGlide;
  }

  changeX3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setTargetXY3D(util.target, Number(util.target?.x || 0) + Number(args.DELTA), util.target?.y);
  }

  setX3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setTargetXY3D(util.target, args.VALUE, util.target?.y);
  }

  xPosition3D(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return util.target?.x || 0;
  }

  changeY3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setTargetXY3D(util.target, util.target?.x, Number(util.target?.y || 0) + Number(args.DELTA));
  }

  setY3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setTargetXY3D(util.target, util.target?.x, args.VALUE);
  }

  yPosition3D(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return util.target?.y || 0;
  }

  changeZ3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(
      util.target,
      "height",
      Number(args.DELTA) / SCRATCH_UNITS_PER_WORLD_UNIT,
      true,
    );
  }

  setZ3D(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(
      util.target,
      "height",
      Number(args.VALUE) / SCRATCH_UNITS_PER_WORLD_UNIT,
    );
  }

  zPosition3D(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return positionZ(util.target);
  }

  direction3D(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return util.target?.direction ?? 90;
  }

  gotoXYZ(args: Record<string, unknown>, util: ExtensionUtil): void {
    const x = Number(args.X);
    const y = Number(args.Y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setTargetXY3D(util.target, x, y);
    }
    setRuntimeTransform(util.target, "height", args.HEIGHT);
  }

  setHeight(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "height", args.HEIGHT);
  }

  changeHeight(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "height", args.DELTA, true);
  }

  height(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return runtimeTransform(util.target).height;
  }

  setYaw(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "yaw", args.ANGLE);
  }

  changeYaw(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "yaw", args.DELTA, true);
  }

  yaw(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return runtimeTransform(util.target).yaw;
  }

  setPitch(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "pitch", args.ANGLE);
  }

  changePitch(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "pitch", args.DELTA, true);
  }

  pitch(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return runtimeTransform(util.target).pitch;
  }

  setRoll(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "roll", args.ANGLE);
  }

  changeRoll(args: Record<string, unknown>, util: ExtensionUtil): void {
    setRuntimeTransform(util.target, "roll", args.DELTA, true);
  }

  roll(_args: Record<string, unknown>, util: ExtensionUtil): number {
    return runtimeTransform(util.target).roll;
  }

  selectModel(args: Record<string, unknown>, util: ExtensionUtil): void {
    const target = util.target;
    const data = dataForTarget(target as never);
    if (!data || !target || target.isStage) return;
    const index = data.models.findIndex((model) => model.name === String(args.MODEL));
    if (index < 0) return;
    if (target.isOriginal) {
      if (data.active === index) return;
      data.active = index;
      save({ sceneChanged: true, actorName: data.name });
      updateThumbnails();
      const editor = getEditor();
      const editingId = (globalThis as { vm?: { editingTarget?: { id?: string } } }).vm?.editingTarget?.id;
      if (editor?.root.isConnected && editingId === target.id) {
        state.selected = [];
        editor.refresh();
      }
    } else if (target.id) {
      runtime.cloneModels.set(target.id, index);
    }
    getStage()?.invalidate();
  }

  modelName(_args: Record<string, unknown>, util: ExtensionUtil): string {
    const data = dataForTarget(util.target);
    if (!data) return "";
    const targetId = util.target?.id;
    const index = (targetId ? runtime.cloneModels.get(targetId) : undefined) ?? data.active;
    return data.models[index]?.name || "";
  }
}
