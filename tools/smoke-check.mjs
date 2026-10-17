/**
 * Boot the built engine in a DOM and make sure it comes up.
 *
 * The editor itself is React and needs a browser, so the check runs against a
 * minimal document: it proves that the bundle parses, that its module level
 * code does not throw, and that the pieces the editor talks to are in place.
 *
 * It then hands the engine a fake VM, the way TurboWarp's editor does, and
 * checks that the 3D extension is registered and that the blocks behave.
 *
 * This runs as its own process because the engine installs a timer that waits
 * for the VM to appear.
 */

import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = pathToFileURL(resolve(root, "dist/dango3d.js")).href;

const dom = new JSDOM(
  `<!doctype html><html><head><title>test</title></head><body>
     <div id="app">
       <div class="stage_stage_"></div>
       <div role="tablist"><button role="tab">Code</button><button role="tab">Costumes</button></div>
       <div role="tabpanel" id="panel-costumes"></div>
     </div>
   </body></html>`,
  { url: "https://example.com/", pretendToBeVisual: true },
);

const { window } = dom;

// The engine runs against the browser globals, so publish the ones it needs.
const globals = [
  "window",
  "document",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "getComputedStyle",
  "ResizeObserver",
  "CustomEvent",
  "Event",
  "Blob",
  "FileReader",
  "Image",
  "ImageBitmap",
  "URL",
  "createImageBitmap",
  "location",
];
for (const name of globals) {
  if (name in window) {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = async () => {
    throw new Error("createImageBitmap is not available in this environment.");
  };
}
globalThis.window = window;
globalThis.document = window.document;

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(" "));
  originalError(...args);
};
window.addEventListener("error", (event) => errors.push(String(event.error || event.message)));

await import(bundle);

const checks = [];
const check = (name, ok) => checks.push([name, !!ok]);

// --- the hooks the editor calls -------------------------------------------
check("the toolbox hook is installed", typeof globalThis.dango3dToolbox === "function");
check("the stage capture hook is installed", typeof globalThis.dango3dStageCapture === "function");

const toolbox = globalThis.dango3dToolbox(
  "<category name='Motion'></category>",
  "<category name='Looks'></category>",
);
check("the toolbox adds the 3D blocks to the motion category", toolbox.motion.includes("dango3d_moveSteps3D"));
check("the toolbox adds the model blocks to the looks category", toolbox.looks.includes("dango3d_selectModel"));

// --- a fake VM, the way TurboWarp's editor hands one over ----------------
const registered = new Map();
const loaded = [];
const fakeVM = {
  extensionManager: {
    addBuiltinExtension: (id, extension) => registered.set(id, extension),
    isBuiltinExtension: (id) => registered.has(id),
    isExtensionLoaded: (id) => loaded.includes(id),
    loadExtensionIdSync: (id) => loaded.push(id),
  },
  runtime: {
    targets: [],
    getTargetForStage: () => null,
    emitProjectChanged: () => {},
  },
  editingTarget: null,
  toJSON: () => JSON.stringify({ targets: [] }),
  serializeAssets: () => [],
};

window.vm = fakeVM;

check("the 3D extension is registered with the extension manager", registered.has("dango3d"));
check("the 3D extension is loaded", loaded.includes("dango3d"));

const Extension = registered.get("dango3d");
const info = new Extension({}).getInfo();
check("the extension is called 3D", info.id === "dango3d" && info.name === "3D");
const opcodes = info.blocks.map((block) => block.opcode);
for (const opcode of [
  "moveSteps3D",
  "turnRight3D",
  "turnLeft3D",
  "pointDirection3D",
  "goToPosition3D",
  "glideToPosition3D",
  "changeX3D",
  "setX3D",
  "xPosition3D",
  "changeY3D",
  "setY3D",
  "yPosition3D",
  "changeZ3D",
  "setZ3D",
  "zPosition3D",
  "direction3D",
  "gotoXYZ",
  "setHeight",
  "changeHeight",
  "height",
  "setYaw",
  "changeYaw",
  "yaw",
  "setPitch",
  "changePitch",
  "pitch",
  "setRoll",
  "changeRoll",
  "roll",
  "selectModel",
  "modelName",
]) {
  check(`the ${opcode} block is defined`, opcodes.includes(opcode));
}

// --- the blocks move an actor ---------------------------------------------
const target = {
  id: "t1",
  isOriginal: true,
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  sprite: { name: "Sprite1" },
  runtime: { requestTargetsUpdate: () => {} },
};
const extension = new Extension({});
extension.moveSteps3D({ STEPS: 10 }, { target });
check("move steps moves the actor along the heading", Math.abs(target.x - 10) < 1e-9);
extension.setX3D({ VALUE: 42 }, { target });
check("set x moves the actor", target.x === 42);
extension.setZ3D({ VALUE: 60 }, { target });
check("set z stores the height in world units", Math.abs(extension.zPosition3D({}, { target }) - 60) < 1e-9);
extension.turnRight3D({ DEGREES: 90 }, { target });
// The heading is measured from the world X axis, so a clockwise turn of 90
// degrees takes the direction from 90 to 180. See docs/ARCHITECTURE.md.
check("turning right changes the direction", target.direction === 180);
extension.turnLeft3D({ DEGREES: 90 }, { target });
check("turning left changes the direction back", target.direction === 90);
extension.setPitch({ ANGLE: 30 }, { target });
check("the pitch is stored", extension.pitch({}, { target }) === 30);

// --- the project file carries the scene -----------------------------------
const serialized = JSON.parse(fakeVM.toJSON());
check("the project carries the 3D payload", !!serialized.dango3d);
check("the payload names the coordinate system", serialized.dango3d?.coordinates?.up === "Y");

check("no errors were reported", errors.length === 0);

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failed++;
    console.log(`not ok - ${name}`);
  }
}
if (errors.length) {
  console.log(`errors:\n${errors.join("\n")}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

process.exit(failed ? 1 : 0);
