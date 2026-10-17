/**
 * Asset storage for imported models.
 *
 * Model files live in IndexedDB so a project can be reopened without the
 * bytes sitting in local storage. When a project is saved the bytes are
 * copied into the project archive through the normal asset hooks.
 */

import { isBase64Payload, safeAssetId } from "../core/schema.ts";
import type { ActorMap } from "../core/types.ts";

/** Folder inside the project archive that holds imported model files. */
export const ASSET_PATH = "dango3d/assets";

const DB_NAME = "dango-3d-assets";
const DB_VERSION = 1;
const STORE_NAME = "files";

/** Bumped whenever the project changes so stale imports are discarded. */
export let assetGeneration = 0;

export const bumpAssetGeneration = (): number => {
  assetGeneration++;
  return assetGeneration;
};

/** Bytes of the imported models that are currently in memory. */
const assetBytes = new Map<string, Uint8Array>();

export const getAssetBytes = (assetId: string): Uint8Array | undefined =>
  assetBytes.get(assetId);

export const setAssetBytes = (assetId: string, bytes: Uint8Array): void => {
  assetBytes.set(assetId, bytes);
};

export const clearAssetBytes = (): void => {
  assetBytes.clear();
};

export const deleteAssetBytes = (assetId: string): void => {
  assetBytes.delete(assetId);
};

const assetDB: Promise<IDBDatabase> = new Promise((resolve, reject) => {
  if (typeof indexedDB === "undefined" || !indexedDB) {
    reject(new Error("IndexedDB is unavailable in this browser."));
    return;
  }
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(STORE_NAME)) {
      open.result.createObjectStore(STORE_NAME);
    }
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
assetDB.catch(() => {
  // The store is optional: without it imported models simply cannot persist.
});

export async function storeAsset(id: string, file: Blob): Promise<void> {
  const db = await assetDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Asset storage was aborted."));
  });
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await assetDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Asset deletion was aborted."));
  });
}

export async function loadAsset(id: string): Promise<Blob | undefined> {
  const db = await assetDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME);
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const encoded = String(dataUrl).split(",").at(-1) ?? "";
  if (!isBase64Payload(encoded)) throw new Error("Invalid base64 model data.");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export interface AssetRef {
  assetId: string;
  format: string;
}

/** Every imported model referenced by the given actors. */
export function collectAssetRefs(actors: ActorMap): AssetRef[] {
  const refs = new Map<string, AssetRef>();
  for (const data of Object.values(actors || {})) {
    for (const model of data?.models || []) {
      for (const object of model.objects || []) {
        const source = object.source;
        if (source && safeAssetId(source.assetId)) {
          refs.set(source.assetId, {
            assetId: source.assetId,
            format: source.format || "glb",
          });
        }
      }
    }
  }
  return [...refs.values()];
}

/** Inline copies of imported models, used when the asset store is empty. */
export function collectEmbeddedAssetData(actors: ActorMap): Map<string, string> {
  const dataById = new Map<string, string>();
  for (const data of Object.values(actors || {})) {
    for (const model of data?.models || []) {
      for (const object of model.objects || []) {
        const source = object.source;
        if (
          source &&
          safeAssetId(source.assetId) &&
          typeof source.data === "string" &&
          !dataById.has(source.assetId)
        ) {
          dataById.set(source.assetId, source.data);
        }
      }
    }
  }
  return dataById;
}

/** The path an asset takes inside the project archive. */
export function assetFileName(asset: { assetId?: string; format?: string } | null): string | null {
  if (!safeAssetId(asset?.assetId)) return null;
  const format = ["glb", "gltf", "obj"].includes(asset?.format || "")
    ? (asset!.format as string)
    : "glb";
  return `${ASSET_PATH}/${asset!.assetId}.${format}`;
}

/** The bytes of an asset, from memory, from the store or from an inline copy. */
export async function bytesForAsset(
  assetId: string,
  source?: { data?: string } | null,
): Promise<Uint8Array | null> {
  const cached = assetBytes.get(assetId);
  if (cached) return cached;
  if (source?.data) {
    // Inline fallback data already occupies substantial string storage. Decode
    // on demand without retaining a second in-memory copy.
    return dataUrlToBytes(source.data);
  }
  const generation = assetGeneration;
  const stored = await loadAsset(assetId);
  if (!stored) return null;
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (generation === assetGeneration) assetBytes.set(assetId, bytes);
  return bytes;
}
