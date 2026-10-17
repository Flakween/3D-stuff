/**
 * Extension registration.
 *
 * TurboWarp's extension manager owns the built in extensions. Registering the
 * 3D blocks through it means the palette, the block definitions and the
 * runtime primitives all come from the same place, and a project that uses
 * the blocks loads them the same way it loads any other extension.
 */

import { Dango3DExtension } from "./blocks.ts";
import { installToolbox } from "./toolbox.ts";

export interface ExtensionManager {
  addBuiltinExtension?: (id: string, extension: unknown) => void;
  isBuiltinExtension?: (id: string) => boolean;
  isExtensionLoaded?: (id: string) => boolean;
  loadExtensionIdSync?: (id: string) => void;
}

interface VmLike {
  extensionManager?: ExtensionManager;
}

/** Register the 3D extension with a VM instance. */
export function installExtension(vm: VmLike | null | undefined): void {
  installToolbox();
  if (!vm) return;
  try {
    const manager = vm.extensionManager;
    if (manager?.addBuiltinExtension && manager?.loadExtensionIdSync) {
      if (!manager.isBuiltinExtension?.("dango3d")) {
        manager.addBuiltinExtension("dango3d", Dango3DExtension);
      }
      if (!manager.isExtensionLoaded?.("dango3d")) {
        manager.loadExtensionIdSync("dango3d");
      }
    }
  } catch (error) {
    console.error("Unable to register the 3D blocks", error);
  }
}
