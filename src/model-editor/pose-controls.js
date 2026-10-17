import {
  dataForTarget,
  positionZ,
  runtimeTransform,
  setDirection3D,
  setRuntimeTransform,
} from "../runtime/actors.ts";
import { SCRATCH_UNITS_PER_WORLD_UNIT } from "../core/coordinates.ts";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
import { setPoseControlsSync } from "../app.ts";

let poseControlFrame = 0;
let poseControlVM = null;
let poseControlVMHandler = null;
let poseControlPane = null;
let poseControlObserver = null;

export function schedulePoseControlsSync() {
  if (poseControlFrame) return;
  poseControlFrame = requestAnimationFrame(() => {
    poseControlFrame = 0;
    syncTargetPoseControls();
  });
}

export function bindPoseControlVM(vm) {
  if (poseControlVM === vm) return;
  if (poseControlVM && poseControlVMHandler) {
    poseControlVM.off?.("TARGETS_UPDATE", poseControlVMHandler);
    poseControlVM.removeListener?.("TARGETS_UPDATE", poseControlVMHandler);
  }
  poseControlVM = vm;
  poseControlVMHandler = () => schedulePoseControlsSync();
  poseControlVM?.on?.("TARGETS_UPDATE", poseControlVMHandler);
}

export function watchPoseControlPane(pane) {
  if (poseControlPane === pane) return;
  poseControlObserver?.disconnect();
  poseControlPane = pane;
  poseControlObserver = null;
  if (!pane) return;
  poseControlObserver = new MutationObserver(schedulePoseControlsSync);
  poseControlObserver.observe(pane, { childList: true, subtree: true });
}

export function createPoseField(axis, label, step) {
  const wrapper = document.createElement("label");
  wrapper.className = "d3-pose-field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(step);
  input.dataset.d3Pose = axis;
  input.setAttribute(
    "aria-label",
    `${label} ${axis === "z" ? "position" : "rotation"}${axis === "z" ? "" : " in degrees"}`,
  );
  input.addEventListener("change", () => {
    const target = window.vm?.editingTarget;
    const value = Number(input.value);
    if (!target || target.id !== input.dataset.targetId || !Number.isFinite(value)) return;
    if (axis === "z") {
      setRuntimeTransform(target, "height", value / SCRATCH_UNITS_PER_WORLD_UNIT);
    } else if (axis === "yaw") {
      // Keep one visible heading by storing edits in the base direction and
      // clearing the extra yaw offset.
      setDirection3D(target, value);
      setRuntimeTransform(target, "yaw", 0);
    } else {
      setRuntimeTransform(target, axis, value);
    }
    schedulePoseControlsSync();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  wrapper.append(caption, input);
  return wrapper;
}

export function syncTargetPoseControls() {
  const target = window.vm?.editingTarget;
  const pane = $('[class*="target-pane_target-pane_"]');
  watchPoseControlPane(pane);
  if (!pane) return;
  const info = $('[class*="sprite-info_sprite-info_"]', pane);
  if (!info) return;

  const actorData = target && !target.isStage ? dataForTarget(target) : null;
  if (!target || target.isStage || !actorData?.models?.length) {
    pane.querySelector(".d3-target-rotation")?.remove();
    pane.querySelector(".d3-target-z")?.remove();
    for (const item of $$(".d3-native-direction-hidden", info)) {
      item.classList.remove("d3-native-direction-hidden");
    }
    return;
  }

  const yInput = [...$$('input[type="number"]', info)].find(
    (input) => input.placeholder?.toLowerCase() === "y",
  );
  const positionRow = yInput?.closest('[class*="sprite-info_row_"]');
  if (positionRow && !positionRow.querySelector(".d3-target-z")) {
    const zField = createPoseField("z", "Z", 0.1);
    zField.classList.add("d3-target-z");
    zField.title = "Vertical position in stage units";
    positionRow.append(zField);
  }

  const directionPicker = info.querySelector('[class*="direction-picker_button-row_"]');
  const nativeDirection = directionPicker?.closest('[class*="sprite-info_larger-input_"]');
  nativeDirection?.classList.add("d3-native-direction-hidden");

  let rotation = pane.querySelector(".d3-target-rotation");
  if (!rotation) {
    rotation = document.createElement("div");
    rotation.className = "d3-target-rotation";
    rotation.setAttribute("role", "group");
    rotation.setAttribute("aria-label", "3D rotation");
    const heading = document.createElement("span");
    heading.className = "d3-target-rotation-title";
    heading.textContent = "3D rotation";
    const fields = document.createElement("div");
    fields.className = "d3-target-rotation-fields";
    fields.append(
      createPoseField("yaw", "Yaw", 1),
      createPoseField("pitch", "Pitch", 1),
      createPoseField("roll", "Roll", 1),
    );
    rotation.append(heading, fields);
    info.after(rotation);
  }

  const transform = runtimeTransform(target, actorData);
  const values = {
    z: positionZ(target),
    yaw: Number(target.direction ?? 90) - transform.yaw,
    pitch: transform.pitch,
    roll: transform.roll,
  };
  for (const input of $$("[data-d3-pose]", pane)) {
    input.dataset.targetId = target.id;
    if (document.activeElement !== input) {
      input.value = String(Number((values[input.dataset.d3Pose] ?? 0).toFixed(1)));
    }
  }
}


// The runtime asks the app to refresh the pose fields after a transform changed.
setPoseControlsSync(schedulePoseControlsSync);
