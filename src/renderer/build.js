import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { normalizeObject } from "../core/schema.ts";
import { geometry, material } from "./primitives.js";
import { applyMaps, setMaterialProperties } from "./materials.js";
import { loadImportedTemplate } from "./import.js";
import { importCache } from "./asset-cache.js";
import { getEditor, requestRender } from "../app.ts";
import { clearThumbnails, updateThumbnails } from "../model-editor/thumbnails.js";

export function buildObject(raw, allowAssetLoad = true) {
  const data = normalizeObject(raw);
  const group = new THREE.Group();
  group.name = data.name;
  group.userData.objectId = data.id;
  group.position.fromArray(data.position);
  group.rotation.fromArray(data.rotation);
  group.scale.fromArray(data.scale);
  if (data.type === "import" && data.source) {
    const done = (template) => {
      const object = cloneSkeleton(template);
      object.traverse((mesh) => {
        if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map((item) => item?.clone())
            : mesh.material.clone();
          mesh.userData.d3SourceMaterial = mesh.material;
          if (data.materialOverride) setMaterialProperties(mesh, data);
        } else {
          mesh.material = material(data);
        }
        applyMaps(mesh, data);
      });
      object.position.fromArray(data.meshPosition);
      object.rotation.fromArray(data.meshRotation);
      object.scale.fromArray(data.meshScale);
      object.userData.d3ModelContent = true;
      group.add(object);
      if (getEditor()?.nodes.get(data.id) === group) {
        getEditor()?.updateGizmo();
        getEditor()?.applyView();
      }
      requestRender();
    };
    if (importCache.has(data.id)) {
      done(importCache.get(data.id));
      return group;
    }
    if (allowAssetLoad) {
      loadImportedTemplate(data).then(
        (template) => {
          if (!group.parent || group.userData.d3Disposed) return;
          done(template);
          clearThumbnails();
          setTimeout(() => {
            updateThumbnails();
            if (getEditor()?.root.isConnected) getEditor()?.updateUI();
          }, 0);
          if (getEditor()?.selectedData()[0]?.id === data.id)
            setTimeout(() => getEditor()?.focusModel(), 0);
        },
        (error) => { if (error.name !== "AbortError") console.error("Model import failed", error); },
      );
    }
  } else if (data.type !== "empty" && data.type !== "import") {
    const mesh = new THREE.Mesh(geometry(data), material(data));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.fromArray(data.meshPosition);
    mesh.rotation.fromArray(data.meshRotation);
    mesh.scale.fromArray(data.meshScale);
    applyMaps(mesh, data);
    group.add(mesh);
  }
  return group;
}
