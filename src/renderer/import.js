import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { bytesForAsset } from "../persistence/assets.ts";
import { assetGeneration, importCache, importPromises } from "./asset-cache.js";
import { disposeImportedTemplate } from "./dispose.js";

function parseGlbJSON(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = 0x46546c67;
  const jsonChunk = 0x4e4f534a;
  if (
    bytes.byteLength < 20 ||
    view.getUint32(0, true) !== magic ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw new Error("Invalid GLB file.");
  }

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.byteLength) throw new Error("Invalid GLB chunk.");
    if (type === jsonChunk) {
      const text = new TextDecoder().decode(bytes.subarray(dataStart, dataEnd));
      return JSON.parse(text.replace(/\0+$/, "").trim());
    }
    offset = dataEnd;
  }
  throw new Error("GLB file has no JSON chunk.");
}

function validateEmbeddedGltfResources(bytes, format) {
  const document =
    format === "gltf"
      ? JSON.parse(new TextDecoder().decode(bytes))
      : parseGlbJSON(bytes);
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Invalid glTF document.");
  }

  for (const resource of [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ]) {
    if (
      resource?.uri != null &&
      (typeof resource.uri !== "string" || !/^data:/i.test(resource.uri))
    ) {
      throw new Error("External glTF resources are not supported.");
    }
  }
}


export function loadImportedTemplate(data) {
  if (importCache.has(data.id))
    return Promise.resolve(importCache.get(data.id));
  if (importPromises.has(data.id)) return importPromises.get(data.id);
  const generation = assetGeneration;
  const loader =
    data.source.format === "obj" ? new OBJLoader() : new GLTFLoader();
  const promise = (async () => {
    const bytes = await bytesForAsset(data.source.assetId, data.source);
    if (!bytes) throw new Error(`Missing model asset ${data.source.assetId}`);
    if (data.source.format === "obj") {
      return loader.parse(new TextDecoder().decode(bytes));
    }
    validateEmbeddedGltfResources(bytes, data.source.format);
    const input =
      data.source.format === "gltf"
        ? new TextDecoder().decode(bytes)
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
    return new Promise((resolve, reject) => {
      loader.parse(input, "", (result) => resolve(result.scene), reject);
    });
  })().then(template => {
    if (generation !== assetGeneration) {
      disposeImportedTemplate(template);
      throw new DOMException("The project changed during import", "AbortError");
    }
    return template;
  });
  importPromises.set(data.id, promise);
  promise.then(
    (template) => {
      if (generation === assetGeneration)
        importCache.set(data.id, template);
      if (importPromises.get(data.id) === promise)
        importPromises.delete(data.id);
    },
    () => {
      if (importPromises.get(data.id) === promise)
        importPromises.delete(data.id);
    },
  );
  return promise;
}

