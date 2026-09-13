import * as THREE from "three";

export type MeshKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "torusKnot"
  | "plane"
  | "icosahedron"
  | "capsule"
  | "ring"
  | "dodecahedron"
  | "tetrahedron";

export type LightKind = "directionalLight" | "pointLight" | "spotLight" | "ambientLight";

export type Kind = MeshKind | LightKind;

export const GEOMETRY_SPECS: Record<MeshKind, { ctor: string; args: number[]; label: string }> = {
  box: { ctor: "BoxGeometry", args: [1, 1, 1], label: "Cube" },
  sphere: { ctor: "SphereGeometry", args: [0.75, 32, 16], label: "Sphere" },
  cylinder: { ctor: "CylinderGeometry", args: [0.5, 0.5, 1.5, 32], label: "Cylinder" },
  cone: { ctor: "ConeGeometry", args: [0.6, 1.4, 32], label: "Cone" },
  torus: { ctor: "TorusGeometry", args: [0.7, 0.25, 16, 64], label: "Torus" },
  torusKnot: { ctor: "TorusKnotGeometry", args: [0.6, 0.2, 128, 24], label: "Torus Knot" },
  plane: { ctor: "PlaneGeometry", args: [2, 2], label: "Plane" },
  icosahedron: { ctor: "IcosahedronGeometry", args: [0.8, 0], label: "Icosphere" },
  capsule: { ctor: "CapsuleGeometry", args: [0.4, 0.9, 8, 24], label: "Capsule" },
  ring: { ctor: "RingGeometry", args: [0.4, 0.9, 48], label: "Ring" },
  dodecahedron: { ctor: "DodecahedronGeometry", args: [0.8, 0], label: "Dodecahedron" },
  tetrahedron: { ctor: "TetrahedronGeometry", args: [0.9, 0], label: "Tetrahedron" },
};

export const LIGHT_LABELS: Record<LightKind, string> = {
  directionalLight: "Sun Light",
  pointLight: "Point Light",
  spotLight: "Spot Light",
  ambientLight: "Ambient Light",
};

export function isLight(kind: Kind): kind is LightKind {
  return kind.endsWith("Light");
}

export function labelFor(kind: Kind) {
  return isLight(kind) ? LIGHT_LABELS[kind] : GEOMETRY_SPECS[kind].label;
}

export function createGeometry(kind: MeshKind): THREE.BufferGeometry {
  const spec = GEOMETRY_SPECS[kind];
  const Ctor = (THREE as unknown as Record<string, new (...a: number[]) => THREE.BufferGeometry>)[
    spec.ctor
  ]!;
  return new Ctor(...spec.args);
}
