import * as THREE from "three";

// View-only geometry: it never becomes part of the saved or exported model.
export class WireframeOverlay {
  constructor() {
    this.overlays = [];
    this.materialOffsets = new Map();
  }

  clear() {
    for (const overlay of this.overlays) {
      overlay.removeFromParent();
      overlay.material.dispose();
      // Geometry and skeleton belong to the surface mesh.
    }
    this.overlays.length = 0;
    for (const [material, offsets] of this.materialOffsets) {
      Object.assign(material, offsets);
    }
    this.materialOffsets.clear();
  }

  update(root, enabled) {
    this.clear();
    if (!enabled) return;
    const meshes = [];
    root.traverse(object => { if (object.isMesh) meshes.push(object); });
    for (const mesh of meshes) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        wireframe: true,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const overlay = mesh.isSkinnedMesh
        ? new THREE.SkinnedMesh(mesh.geometry, material)
        : new THREE.Mesh(mesh.geometry, material);
      if (mesh.isSkinnedMesh) {
        overlay.skeleton = mesh.skeleton;
        overlay.bindMode = mesh.bindMode;
        overlay.bindMatrix.copy(mesh.bindMatrix);
        overlay.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      }
      overlay.morphTargetInfluences = mesh.morphTargetInfluences;
      overlay.morphTargetDictionary = mesh.morphTargetDictionary;
      overlay.userData.d3WireframeOverlay = true;
      overlay.raycast = () => {};
      overlay.renderOrder = mesh.renderOrder + 1;
      overlay.frustumCulled = mesh.frustumCulled;
      mesh.add(overlay);
      this.overlays.push(overlay);
      // Offset filled polygons so coplanar wire lines stay crisp without
      // exposing edges hidden behind the front surface.
      for (const surface of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!surface || this.materialOffsets.has(surface)) continue;
        this.materialOffsets.set(surface, {
          polygonOffset: surface.polygonOffset,
          polygonOffsetFactor: surface.polygonOffsetFactor,
          polygonOffsetUnits: surface.polygonOffsetUnits,
        });
        surface.polygonOffset = true;
        surface.polygonOffsetFactor = 1;
        surface.polygonOffsetUnits = 1;
      }
    }
  }
}
