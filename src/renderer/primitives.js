import * as THREE from "three";
import { subdivideMesh } from "../ui/mesh-subdivision.js";
import { clamp } from "../core/schema.ts";

export function starGeometry(points, inner, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2,
      r = i % 2 ? inner : 1;
    const x = Math.cos(a) * r,
      y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.05, depth),
    bevelEnabled: false,
    steps: 1,
  });
  g.center();
  g.rotateX(-Math.PI / 2);
  return g;
}
export function geometry(d) {
  return subdivideMesh(primitiveGeometry({...d, subdivisions:1}), d.subdivisions, d.linear);
}
export function primitiveGeometry(d) {
  const width = Math.max(0.05, Number(d.width) || 1);
  const height = Math.max(0.05, Number(d.height) || 1);
  const depth = Math.max(0.05, Number(d.depth) || 1);
  const subdivisions = clamp(Number(d.subdivisions) || 1, 1, 16);
  switch (d.type) {
    case "cube":
      return new THREE.BoxGeometry(
        width,
        height,
        depth,
        subdivisions,
        subdivisions,
        subdivisions,
      );
    case "sphere": {
      const g = new THREE.SphereGeometry(
        1,
        Math.max(12, subdivisions * 12),
        Math.max(8, subdivisions * 8),
      );
      g.scale(width / 2, height / 2, depth / 2);
      return g;
    }
    case "cylinder": {
      const g = new THREE.CylinderGeometry(
        1,
        1,
        height,
        Math.max(12, subdivisions * 12),
        subdivisions,
      );
      g.scale(width / 2, 1, depth / 2);
      return g;
    }
    case "cone": {
      const g = new THREE.ConeGeometry(
        1,
        height,
        Math.max(16, subdivisions * 16),
        subdivisions,
      );
      g.scale(width / 2, 1, depth / 2);
      return g;
    }
    case "plane": {
      const g = new THREE.PlaneGeometry(
        width,
        depth,
        subdivisions,
        subdivisions,
      );
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "torus": {
      const g = new THREE.TorusGeometry(
        width / 2,
        Math.max(0.06, height / 5),
        Math.max(6, subdivisions * 6),
        Math.max(16, subdivisions * 16),
      );
      g.scale(1, depth / Math.max(width, 0.05), 1);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "star": {
      const points = clamp(Number(d.points) || 5, 3, 24);
      const angle = THREE.MathUtils.degToRad(
        clamp(Number(d.innerAngle) || 120, 30, 175),
      );
      const phi = Math.PI / points;
      const inner = clamp(
        Math.cos(phi) - Math.sin(phi) / Math.tan(angle / 2),
        0.05,
        0.95,
      );
      const g = starGeometry(points, inner, height);
      g.scale(width / 2, 1, depth / 2);
      return g;
    }
    default:
      return new THREE.BoxGeometry(width, height, depth);
  }
}
export function material(d) {
  return new THREE.MeshStandardMaterial({
    color: d.color,
    metalness: clamp(Number(d.metallic) || 0, 0, 1),
    roughness: 1 - clamp(Number(d.smoothness) || 0, 0, 1),
    transparent: d.opacity < 1,
    opacity: clamp(Number(d.opacity) || 0, 0, 1),
    depthWrite: d.opacity >= 1,
    side: d.type === "plane" ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: false,
  });
}
