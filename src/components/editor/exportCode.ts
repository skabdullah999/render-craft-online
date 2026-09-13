import * as THREE from "three";
import { GEOMETRY_SPECS, isLight, type Kind } from "./geometry";

export type ExportItem = {
  id: string;
  name: string;
  kind: Kind;
  object: THREE.Object3D;
};

const n = (v: number) => Number(v.toFixed(4)).toString();
const varName = (name: string, i: number) => {
  const base = name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^[0-9]/, "_");
  return `${base || "object"}_${i}`;
};

export function generateThreeCode(items: ExportItem[], background: string) {
  const lines: string[] = [];
  lines.push(`// Generated with Lovable Modeler — a Blender-style editor for the web.`);
  lines.push(`// Drop this file in your project and call createScene(canvas).`);
  lines.push(`import * as THREE from "three";`);
  lines.push(`import { OrbitControls } from "three/addons/controls/OrbitControls.js";`);
  lines.push(``);
  lines.push(`export function createScene(canvas) {`);
  lines.push(`  const scene = new THREE.Scene();`);
  lines.push(`  scene.background = new THREE.Color("${background}");`);
  lines.push(``);

  items.forEach((item, i) => {
    const v = varName(item.name, i);
    const o = item.object;
    lines.push(`  // ${item.name}`);
    if (isLight(item.kind)) {
      const light = o as THREE.Light;
      const color = `#${light.color.getHexString()}`;
      if (item.kind === "ambientLight") {
        lines.push(`  const ${v} = new THREE.AmbientLight("${color}", ${n(light.intensity)});`);
      } else if (item.kind === "directionalLight") {
        lines.push(`  const ${v} = new THREE.DirectionalLight("${color}", ${n(light.intensity)});`);
      } else if (item.kind === "pointLight") {
        lines.push(`  const ${v} = new THREE.PointLight("${color}", ${n(light.intensity)}, 0, 2);`);
      } else {
        lines.push(
          `  const ${v} = new THREE.SpotLight("${color}", ${n(light.intensity)}, 0, Math.PI / 6, 0.3);`,
        );
      }
      if (item.kind !== "ambientLight") {
        lines.push(
          `  ${v}.position.set(${n(o.position.x)}, ${n(o.position.y)}, ${n(o.position.z)});`,
        );
        lines.push(`  ${v}.castShadow = true;`);
      }
    } else {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const spec = GEOMETRY_SPECS[item.kind as keyof typeof GEOMETRY_SPECS];
      const deformed = mesh.userData['deformed'] === true;
      if (deformed) {
        const pos = mesh.geometry.getAttribute("position");
        const norm = mesh.geometry.getAttribute("normal");
        const index = mesh.geometry.getIndex();
        const fmt = (a: ArrayLike<number>) =>
          Array.from(a as ArrayLike<number>)
            .map((x) => n(x))
            .join(",");
        lines.push(`  // edited with the point cage — vertices are baked in`);
        lines.push(`  const ${v}_geometry = new THREE.BufferGeometry();`);
        lines.push(
          `  ${v}_geometry.setAttribute("position", new THREE.Float32BufferAttribute([${fmt(pos.array as ArrayLike<number>)}], 3));`,
        );
        if (norm) {
          lines.push(
            `  ${v}_geometry.setAttribute("normal", new THREE.Float32BufferAttribute([${fmt(norm.array as ArrayLike<number>)}], 3));`,
          );
        }
        if (index) {
          lines.push(
            `  ${v}_geometry.setIndex([${Array.from(index.array as ArrayLike<number>).join(",")}]);`,
          );
        }
      }
      lines.push(`  const ${v} = new THREE.Mesh(`);
      lines.push(
        deformed
          ? `    ${v}_geometry,`
          : `    new THREE.${spec.ctor}(${spec.args.map(n).join(", ")}),`,
      );
      lines.push(`    new THREE.MeshStandardMaterial({`);
      lines.push(`      color: "#${mat.color.getHexString()}",`);
      lines.push(`      metalness: ${n(mat.metalness)},`);
      lines.push(`      roughness: ${n(mat.roughness)},`);
      lines.push(`      wireframe: ${mat.wireframe},`);
      lines.push(`      flatShading: ${mat.flatShading},`);
      lines.push(`      side: THREE.DoubleSide,`);
      lines.push(`    }),`);
      lines.push(`  );`);
      lines.push(`  ${v}.position.set(${n(o.position.x)}, ${n(o.position.y)}, ${n(o.position.z)});`);
      lines.push(`  ${v}.rotation.set(${n(o.rotation.x)}, ${n(o.rotation.y)}, ${n(o.rotation.z)});`);
      lines.push(`  ${v}.scale.set(${n(o.scale.x)}, ${n(o.scale.y)}, ${n(o.scale.z)});`);
      lines.push(`  ${v}.castShadow = true;`);
      lines.push(`  ${v}.receiveShadow = true;`);
    }
    lines.push(`  ${v}.name = ${JSON.stringify(item.name)};`);
    lines.push(`  scene.add(${v});`);
    lines.push(``);
  });

  lines.push(`  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);`);
  lines.push(`  camera.position.set(5, 4, 7);`);
  lines.push(``);
  lines.push(`  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });`);
  lines.push(`  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`);
  lines.push(`  renderer.shadowMap.enabled = true;`);
  lines.push(``);
  lines.push(`  const controls = new OrbitControls(camera, renderer.domElement);`);
  lines.push(`  controls.enableDamping = true;`);
  lines.push(``);
  lines.push(`  function resize() {`);
  lines.push(`    const w = canvas.clientWidth || window.innerWidth;`);
  lines.push(`    const h = canvas.clientHeight || window.innerHeight;`);
  lines.push(`    renderer.setSize(w, h, false);`);
  lines.push(`    camera.aspect = w / h;`);
  lines.push(`    camera.updateProjectionMatrix();`);
  lines.push(`  }`);
  lines.push(`  window.addEventListener("resize", resize);`);
  lines.push(`  resize();`);
  lines.push(``);
  lines.push(`  renderer.setAnimationLoop(() => {`);
  lines.push(`    controls.update();`);
  lines.push(`    renderer.render(scene, camera);`);
  lines.push(`  });`);
  lines.push(``);
  lines.push(`  return { scene, camera, renderer, controls };`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}
