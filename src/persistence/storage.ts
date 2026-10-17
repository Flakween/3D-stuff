/**
 * The local project cache.
 *
 * The editor keeps a copy of the 3D scene in local storage so a reload does
 * not lose work before the project was saved to a file. The cache is keyed by
 * project id and validated against the project's target signature.
 */

import { normalizeActors, normalizeScenes } from "../core/schema.ts";
import { state } from "../state.ts";
import { bytesForAsset, collectAssetRefs } from "./assets.ts";
import { flushSave } from "./save.ts";

/** Key of the cache used before the 3D scene was part of a project. */
export const LEGACY_STORAGE_KEY = "dango-3d-models-v1";

/** Prefix of the per project cache key. */
export const STORAGE_PREFIX = "dango-3d-scene-v2:";

/**
 * Find the id of the project that is open.
 *
 * Websim hosts a project at `/p/<id>`. When the editor runs outside of
 * Websim the id is derived from the location so the cache still works.
 */
export async function resolveProjectId(): Promise<string> {
  const fromPath = location.pathname.match(/\/p\/([^/]+)/)?.[1];
  if (fromPath) return fromPath;
  const websim = (globalThis as { websim?: { getCurrentProject?: () => Promise<{ id?: string } | null> } })
    .websim;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const project = await websim?.getCurrentProject?.();
      if (project?.id) return String(project.id);
    } catch {
      // Local preview may start before its Websim identity bootstrap is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return `local:${location.origin}${location.pathname}`;
}

export const projectIdPromise: Promise<string> = resolveProjectId();

/** Load the bytes of every imported model the scene refers to. */
export async function hydrateAssetCache(): Promise<void> {
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
}

/**
 * Read the local cache for this project and put it into the shared state.
 * Older caches are migrated on the way.
 */
export async function initializeProjectState(): Promise<boolean> {
  state.projectId = await projectIdPromise;
  state.storageKey = `${STORAGE_PREFIX}${encodeURIComponent(state.projectId)}`;

  let cached: {
    actors?: unknown;
    scenes?: unknown;
    signature?: string | null;
  } | null = null;
  let migratedLegacy = false;

  try {
    cached = JSON.parse(localStorage.getItem(state.storageKey) || "null");
  } catch (error) {
    console.warn("Could not read the 3D project cache", error);
  }

  if (!cached) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
      if (legacy && typeof legacy === "object") {
        cached = { actors: legacy, signature: null };
        migratedLegacy = true;
        console.info("Migrating the previous local 3D model cache.");
      }
    } catch (error) {
      console.warn("Could not migrate the previous 3D model cache", error);
    }
  }

  state.actors = normalizeActors(cached?.actors || {});
  state.scenes = normalizeScenes(cached?.scenes);
  state.projectSignature = cached?.signature || null;

  await hydrateAssetCache();

  if (migratedLegacy) {
    flushSave();
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.warn("Could not remove the migrated 3D cache", error);
    }
  }
  return true;
}

/** The promise that resolves once the local cache has been read. */
export const readyPromise: Promise<boolean> = initializeProjectState().catch((error) => {
  console.warn("3D project storage is unavailable; using an empty scene.", error);
  state.projectId = state.projectId || "local";
  state.storageKey = `${STORAGE_PREFIX}${encodeURIComponent(state.projectId)}`;
  state.actors = Object.create(null);
  return false;
});
