/**
 * Project integration.
 *
 * The 3D payload travels inside the Scratch project file. TurboWarp's editor
 * is loaded as a prebuilt bundle, so the only seam available today is the VM
 * itself: `toJSON`, `serializeAssets` and `deserializeProject` are wrapped
 * once, here, instead of being patched from several places.
 *
 * When this project is rebuilt on top of a scratch-gui fork the three hooks
 * below become the places where the GUI's own project saver and loader call
 * into the 3D engine. Nothing else in the codebase touches the VM's
 * serialization.
 */

import { SCRATCH_UNITS_PER_WORLD_UNIT } from "../core/coordinates.ts";
import { migrateProjectScene, safeAssetId } from "../core/schema.ts";
import type { ActorMap } from "../core/types.ts";
import { getEditor, getStage, requestRender } from "../app.ts";
import { runtime, state } from "../state.ts";
import { installExtension } from "../extension/register.ts";
import type { ExtensionManager } from "../extension/register.ts";
import { clearProjectAssetCaches } from "../renderer/asset-cache.js";
import { clearThumbnails, updateThumbnails } from "../model-editor/thumbnails.js";
import { captureRuntimeSettings, restoreRuntimeSettings } from "../runtime/settings.ts";
import {
  assetFileName,
  bytesForAsset,
  collectAssetRefs,
  collectEmbeddedAssetData,
  dataUrlToBytes,
  getAssetBytes,
  setAssetBytes,
  storeAsset,
} from "./assets.ts";
import { actorsByName, clearSaveTimers, flushSave } from "./save.ts";
import { readyPromise } from "./storage.ts";

/** Field inside the Scratch project JSON that holds the 3D payload. */
export const PROJECT_FIELD = "dango3d";

const hookedVMs = new WeakSet<object>();

/** A signature of the targets in a project, used to detect a different project. */
export function projectSignature(projectJSON: unknown): string {
  const targets = (projectJSON as { targets?: Array<Record<string, unknown>> })?.targets || [];
  return targets
    .filter((target) => !target.isStage)
    .map((target) => {
      const costumes = ((target.costumes || []) as Array<Record<string, unknown>>)
        .map((costume) => costume.assetId || costume.md5ext || costume.name)
        .join(",");
      return `${target.name || ""}:${costumes}`;
    })
    .sort()
    .join("|");
}

/** The 3D payload that is stored inside the project file. */
export function sceneProjectData(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: state.projectId,
    signature: state.projectSignature,
    coordinates: {
      up: "Y",
      scratchX: "X",
      scratchY: "-Z",
      unitsPerStep: 1 / SCRATCH_UNITS_PER_WORLD_UNIT,
    },
    actors: actorsByName(),
    scenes: state.scenes,
    assets: collectAssetRefs(state.actors),
    advancedSettings: captureRuntimeSettings(
      (globalThis as { vm?: Parameters<typeof captureRuntimeSettings>[0] }).vm,
    ),
  };
}

/** Restore the 3D payload that was stored inside a project file. */
export async function restoreProjectScene(
  sceneData: Record<string, unknown>,
  zip: { file?: (path: string) => { async: (type: string) => Promise<Uint8Array> } | null } | null,
  signature: string | null,
): Promise<void> {
  clearProjectAssetCaches();
  runtime.actorRevisions.clear();
  runtime.sceneRevision++;
  const migrated = migrateProjectScene(sceneData);
  state.actors = migrated.actors as ActorMap;
  state.scenes = migrated.scenes;
  state.projectSignature = (sceneData.signature as string) || signature || null;
  state.targetTransforms.clear();

  const refs = Array.isArray(sceneData.assets)
    ? (sceneData.assets as Array<{ assetId?: string; format?: string }>).filter((asset) =>
        safeAssetId(asset?.assetId),
      )
    : collectAssetRefs(state.actors);

  await Promise.all(
    refs.map(async (asset) => {
      try {
        let bytes = await bytesForAsset(asset.assetId as string, null).catch(() => null);
        const path = assetFileName(asset);
        const entry = path ? zip?.file?.(path) : null;
        if (!bytes && entry) bytes = await entry.async("uint8array");
        if (!bytes) bytes = await bytesForAsset(asset.assetId as string, null);
        if (bytes) {
          const normalizedBytes = new Uint8Array(bytes);
          setAssetBytes(asset.assetId as string, normalizedBytes);
          await storeAsset(asset.assetId as string, new Blob([normalizedBytes]));
        }
      } catch (error) {
        console.warn(`Unable to restore 3D asset ${asset.assetId}`, error);
      }
    }),
  );

  flushSave();
}

/** Fall back to the local cache when a project carries no 3D payload. */
export async function restoreCacheForProject(
  projectJSON: unknown,
  signature: string | null,
): Promise<void> {
  clearProjectAssetCaches();
  runtime.actorRevisions.clear();
  runtime.sceneRevision++;

  if (runtime.projectLoadedOnce) {
    state.actors = Object.create(null) as ActorMap;
    state.scenes = [];
    state.targetTransforms.clear();
  } else if (state.projectSignature && state.projectSignature !== signature) {
    // A different project is being opened: only keep the actors whose names
    // still exist in the new project.
    const names = new Set(
      ((projectJSON as { targets?: Array<Record<string, unknown>> })?.targets || [])
        .filter((target) => !target.isStage)
        .map((target) => target.name as string),
    );
    const matchingActors = Object.create(null) as ActorMap;
    for (const [key, data] of Object.entries(state.actors)) {
      if (names.has(data.name)) matchingActors[key] = data;
    }
    state.actors = matchingActors;
  }

  state.projectSignature = signature || state.projectSignature;
  state.targetTransforms.clear();

  const refs = collectAssetRefs(state.actors);
  await Promise.all(
    refs.map(async (asset) => {
      try {
        await bytesForAsset(asset.assetId, null);
      } catch (error) {
        console.warn(`Unable to restore 3D asset ${asset.assetId}`, error);
      }
    }),
  );

  flushSave();
}

interface VmLike {
  toJSON?: (targetId?: string, options?: unknown) => string;
  serializeAssets?: (targetId?: string) => Array<{ fileName: string; fileContent: Uint8Array }>;
  deserializeProject?: (projectJSON: string, zip?: unknown) => Promise<unknown> | unknown;
  extensionManager?: ExtensionManager;
  runtime?: { getTargetForStage?: () => unknown };
}

/**
 * Install the 3D blocks and the project hooks on a VM instance.
 * Calling this twice with the same VM does nothing.
 */
export function installProjectHooks(vm: VmLike | null | undefined): void {
  if (!vm || (typeof vm !== "object" && typeof vm !== "function")) return;
  if (hookedVMs.has(vm as unknown as object)) return;
  hookedVMs.add(vm as unknown as object);

  installExtension(vm);

  if (typeof vm.toJSON === "function") {
    const originalToJSON = vm.toJSON.bind(vm);
    vm.toJSON = (targetId?: string, serializationOptions?: unknown) => {
      const serialized = originalToJSON(targetId, serializationOptions);
      if (targetId) return serialized;
      try {
        const projectJSON = JSON.parse(serialized);
        projectJSON[PROJECT_FIELD] = sceneProjectData();
        return JSON.stringify(projectJSON);
      } catch (error) {
        console.error("Unable to serialize the 3D scene with the project", error);
        return serialized;
      }
    };
  }

  if (typeof vm.serializeAssets === "function") {
    const originalSerializeAssets = vm.serializeAssets.bind(vm);
    vm.serializeAssets = (targetId?: string) => {
      const files = originalSerializeAssets(targetId);
      if (targetId) return files;
      let embeddedAssetData: Map<string, string> | undefined;
      for (const asset of collectAssetRefs(state.actors)) {
        let bytes = getAssetBytes(asset.assetId);
        if (!bytes) {
          embeddedAssetData ||= collectEmbeddedAssetData(state.actors);
          const sourceData = embeddedAssetData.get(asset.assetId);
          if (sourceData) bytes = dataUrlToBytes(sourceData);
        }
        const fileName = assetFileName(asset);
        if (bytes && fileName) {
          files.push({ fileName, fileContent: bytes });
        } else {
          console.warn(`3D asset ${asset.assetId} is not ready to be saved yet.`);
        }
      }
      return files;
    };
  }

  if (typeof vm.deserializeProject === "function") {
    const originalDeserializeProject = vm.deserializeProject.bind(vm);
    let loadQueue: Promise<unknown> = Promise.resolve();
    vm.deserializeProject = (projectJSON: string, zip?: unknown) => {
      // A second file open must not interleave target installation or asset
      // restoration with the previous load. Failed loads do not poison the queue.
      const load = async () => {
        runtime.projectLoading = true;
        clearSaveTimers();
        const loadingEditor = getEditor();
        if (loadingEditor) loadingEditor.historyPending = false;
        try {
          const parsed = JSON.parse(projectJSON) as Record<string, unknown>;
          const signature = projectSignature(parsed);
          const sceneData = parsed[PROJECT_FIELD] as Record<string, unknown> | undefined;
          const result = await originalDeserializeProject(projectJSON, zip);
          await readyPromise;
          restoreRuntimeSettings(
            (globalThis as { vm?: Parameters<typeof restoreRuntimeSettings>[0] }).vm,
            sceneData?.advancedSettings as never,
          );
          if (sceneData?.schemaVersion === 1) {
            await restoreProjectScene(sceneData, zip as never, signature);
          } else {
            await restoreCacheForProject(parsed, signature);
          }
          runtime.projectLoadedOnce = true;
          state.targetTransforms.clear();
          runtime.cloneModels.clear();
          clearThumbnails();
          getStage()?.markDirty();
          const openEditor = getEditor();
          if (openEditor?.root.isConnected) {
            state.selected = [];
            openEditor.history = [];
            openEditor.historyIndex = -1;
            openEditor.historyPending = false;
            openEditor.refresh();
            openEditor.recordHistory(true);
          }
          updateThumbnails();
          return result;
        } finally {
          runtime.projectLoading = false;
          requestRender();
          scheduleSyncDOM();
        }
      };
      const pending = loadQueue.then(load);
      loadQueue = pending.catch(() => undefined);
      return pending;
    };
  }
}

// Filled in by the editor entry point so the persistence layer does not have
// to know how the editor schedules its DOM work.
let scheduleSyncDOM: () => void = () => undefined;

export const provideScheduleSyncDOM = (handler: () => void): void => {
  scheduleSyncDOM = handler;
};
