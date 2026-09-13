import * as THREE from "three";

/** How close (in world units) an edge has to be before it clicks into place. */
export const SNAP_TOLERANCE = 0.18;

type Axis = 0 | 1 | 2;
const AXIS_KEY = ["x", "y", "z"] as const;

const GUIDE_COLOR = 0x38bdf8;
const GUIDE_LEN = 24;

/**
 * Blender/Figma style alignment snapping.
 * While an object is dragged, its box edges and centre are compared with every
 * other object (and the floor grid). Within the tolerance the object jumps the
 * last 1-2 "threads" into alignment and a guide line is drawn.
 */
export class SnapGuides {
  readonly group = new THREE.Group();
  private lines: THREE.Line[] = [];

  constructor() {
    this.group.renderOrder = 997;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        g,
        new THREE.LineDashedMaterial({
          color: GUIDE_COLOR,
          dashSize: 0.35,
          gapSize: 0.2,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      line.renderOrder = 997;
      line.visible = false;
      this.lines.push(line);
      this.group.add(line);
    }
  }

  clear() {
    this.lines.forEach((l) => (l.visible = false));
  }

  private showGuide(slot: number, axis: Axis, value: number, center: THREE.Vector3) {
    const line = this.lines[slot];
    if (!line) return;
    const a = center.clone();
    const b = center.clone();
    a[AXIS_KEY[axis]] = value;
    b[AXIS_KEY[axis]] = value;
    // draw the guide along the longest perpendicular axis
    const along: Axis = axis === 1 ? 0 : 1;
    a[AXIS_KEY[along]] -= GUIDE_LEN / 2;
    b[AXIS_KEY[along]] += GUIDE_LEN / 2;
    const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    arr[0] = a.x;
    arr[1] = a.y;
    arr[2] = a.z;
    arr[3] = b.x;
    arr[4] = b.y;
    arr[5] = b.z;
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
    line.visible = true;
  }

  /** Snap `target` against `others`; returns true when anything snapped. */
  apply(target: THREE.Object3D, others: THREE.Object3D[], gridSnap = true): boolean {
    this.clear();
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return false;
    const center = new THREE.Vector3();
    box.getCenter(center);

    const refs: { axis: Axis; value: number }[] = [];
    for (const o of others) {
      const ob = new THREE.Box3().setFromObject(o);
      if (ob.isEmpty()) continue;
      const oc = new THREE.Vector3();
      ob.getCenter(oc);
      for (const axis of [0, 1, 2] as Axis[]) {
        const k = AXIS_KEY[axis];
        refs.push({ axis, value: ob.min[k] });
        refs.push({ axis, value: ob.max[k] });
        refs.push({ axis, value: oc[k] });
      }
    }
    if (gridSnap) {
      for (const axis of [0, 1, 2] as Axis[]) {
        const k = AXIS_KEY[axis];
        refs.push({ axis, value: Math.round(center[k] * 2) / 2 });
        refs.push({ axis, value: Math.round(box.min[k] * 2) / 2 });
      }
    }

    let snapped = false;
    let slot = 0;
    for (const axis of [0, 1, 2] as Axis[]) {
      const k = AXIS_KEY[axis];
      const mine = [box.min[k], center[k], box.max[k]];
      let best: { delta: number; value: number } | null = null;
      for (const r of refs) {
        if (r.axis !== axis) continue;
        for (const m of mine) {
          const d = r.value - m;
          if (Math.abs(d) <= SNAP_TOLERANCE && (!best || Math.abs(d) < Math.abs(best.delta))) {
            best = { delta: d, value: r.value };
          }
        }
      }
      if (best && Math.abs(best.delta) > 1e-6) {
        target.position[k] += best.delta;
        center[k] += best.delta;
        snapped = true;
        this.showGuide(slot++, axis, best.value, center);
      }
    }
    if (snapped) target.updateMatrixWorld();
    return snapped;
  }

  dispose() {
    this.lines.forEach((l) => {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    });
    this.group.clear();
  }
}

const EPS = 1e-3;

/** True when `target` overlaps any solid object (solid objects are impassable). */
export function hitsSolid(target: THREE.Object3D, solids: THREE.Object3D[]): boolean {
  if (!solids.length) return false;
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return false;
  box.expandByScalar(-EPS);
  return solids.some((o) => {
    if (o === target) return false;
    const ob = new THREE.Box3().setFromObject(o);
    return !ob.isEmpty() && ob.intersectsBox(box);
  });
}
