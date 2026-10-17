import * as THREE from "three";
import { envTexture, skyVertex, skyFragment } from "./textures.js";
import { state } from "../state.ts";

export function makeScene(grid = false) {
  const scene = new THREE.Scene();
  scene.environment = envTexture;
  if (grid) scene.background = new THREE.Color(0x000000);
  else {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: { uSkyColor: { value: new THREE.Color("#ff9c5c").convertLinearToSRGB() } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    sky.name = "3D background";
    scene.add(sky);
  }
  scene.add(new THREE.HemisphereLight(0xffefdd, 0x8995a5, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-3, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.bias = -0.00015;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffab68, 1.1);
  fill.position.set(5, 2, -4);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({
      color: grid ? 0x080808 : 0x999b9d,
      roughness: 0.92,
      metalness: 0.03,
    }),
  );
  floor.name = "3D ground";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);
  if (grid) {
    const helper = new THREE.GridHelper(40, 40, 0x7d5535, 0x555555);
    helper.name = "3D grid";
    helper.position.y = 0.005;
    helper.material.transparent = true;
    helper.material.opacity = 0.45;
    scene.add(helper);
  }
  return scene;
}
export function makeRenderer(canvas, antialias = true, alpha = false) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias,
    powerPreference: "default",
    alpha,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = state.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}
