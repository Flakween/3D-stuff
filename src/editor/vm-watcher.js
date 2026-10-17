/**
 * Watch for the VM.
 *
 * TurboWarp's editor creates the VM and assigns it to `window.vm`. The 3D
 * engine has to install its hooks on that instance, and it has to do it again
 * when the editor replaces the VM, for example after a hard reload.
 */

import { installProjectHooks } from "../persistence/project.ts";
import { scheduleSyncDOM } from "./dom-sync.js";

export function watchVmAssignment() {
  const descriptor = Object.getOwnPropertyDescriptor(window, "vm");
  if (descriptor && !descriptor.configurable) {
    installProjectHooks(window.vm);
    return;
  }
  let current = window.vm;
  Object.defineProperty(window, "vm", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => current,
    set: (vm) => {
      current = vm;
      installProjectHooks(vm);
      scheduleSyncDOM();
    },
  });
  installProjectHooks(current);
}
