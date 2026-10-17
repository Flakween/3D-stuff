import * as THREE from "three";
import { clamp } from "../core/schema.ts";

export const skyVertex =
  "varying vec3 vPos; void main(){vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
export const skyFragment =
  "uniform vec3 uSkyColor; varying vec3 vPos; void main(){float h=normalize(vPos).y; vec3 low=uSkyColor*vec3(1.0,.72,.55); vec3 mid=uSkyColor*vec3(1.0,1.1,1.05); vec3 high=uSkyColor*vec3(.89,.51,.61); vec3 c=mix(low,mid,smoothstep(-.2,.15,h)); c=mix(c,high,smoothstep(.05,.95,h)); gl_FragColor=vec4(c,1.0);}";
export function sampledColor(stops, position) {
  const end = stops.findIndex(([stop]) => position <= stop);
  if (end <= 0) return stops[0][1].slice();
  const [startPosition, startColor] = stops[end - 1];
  const [endPosition, endColor] = stops[end];
  const fraction = (position - startPosition) / (endPosition - startPosition);
  return startColor.map((channel, index) => channel + (endColor[index] - channel) * fraction);
}

export function pixelTexture(width, height, sample) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = sample(x, y);
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

export function resizedImageDataURL(bitmap) {
  const scale = Math.min(1, 1024 / bitmap.width, 512 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  const texture = new THREE.Texture(bitmap);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  try {
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // ImageBitmap was flipped when decoded for WebGL UVs.
    texture.needsUpdate = true;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    geometry.dispose();
    material.dispose();
    texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}

export function fileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function environment() {
  const stops = [
    [0, [238, 243, 255]], [.45, [255, 245, 232]],
    [.55, [255, 180, 110]], [1, [73, 76, 89]],
  ];
  const glows = [[100, 95, 55], [360, 100, 28], [445, 130, 14]];
  const tex = pixelTexture(512, 256, (x, y) => {
    const color = sampledColor(stops, y / 255);
    for (const [cx, cy, radius] of glows) {
      const distance = Math.hypot(x - cx, y - cy) / radius;
      const alpha = Math.max(0, 1 - distance) ** .65;
      for (let channel = 0; channel < 3; channel++) color[channel] += (255 - color[channel]) * alpha;
    }
    return color;
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
export const envTexture = environment();
export function matcap() {
  const stops = [
    [0, [255, 255, 255]], [.35, [255, 182, 109]],
    [.7, [156, 74, 49]], [1, [55, 42, 55]],
  ];
  return pixelTexture(128, 128, (x, y) =>
    sampledColor(stops, clamp((Math.hypot(x - 42, y - 34) - 4) / 76, 0, 1))
  );
}
export const matcapTexture = matcap();
