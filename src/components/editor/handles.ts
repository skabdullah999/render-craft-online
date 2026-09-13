import * as THREE from "three";

/** Which local plane the 4 corner points live on. */
export type HandlePlane = "xy" | "xz" | "zy";
/** linked = opposite corners mirror each other, free = every point moves alone. */
export type HandleMode = "linked" | "free";

type Axis = "x" | "y" | "z";

const AXES: Record<HandlePlane, [Axis, Axis, Axis]> = {
  // [horizontal axis, vertical axis, plane normal axis]
  xy: ["x", "y", "z"],
  xz: ["x", "z", "y"],
  zy: ["z", "y", "x"],
};

const HANDLE_COLOR = 0xffb020;
const HANDLE_ACTIVE = 0x36d399;
const OUTLINE_COLOR = 0x36d399;
const SEG = 18;

type Corner = { h: number; v: number };

export type CageState = {
  plane: HandlePlane;
  mode: HandleMode;
  curve: number;
  corners: Corner[];
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function bez(a: THREE.Vector2, c: THREE.Vector2, b: THREE.Vector2, t: number, out: THREE.Vector2) {
  const it = 1 - t;
  out.set(
    it * it * a.x + 2 * it * t * c.x + t * t * b.x,
    it * it * a.y + 2 * it * t * c.y + t * t * b.y,
  );
  return out;
}

/**
 * 4 draggable points around the selected mesh.
 * - linked mode resizes width/height symmetrically
 * - free mode moves each point on its own (corner sculpting)
 * - curve bends the 4 edges into arcs and deforms the mesh with a Coons patch
 */
export class BoxHandles {
  readonly group = new THREE.Group();
  dragging = false;

  private object: THREE.Mesh | null = null;
  private plane: HandlePlane = "xy";
  private mode: HandleMode = "linked";
  private curve = 0;
  private corners: Corner[] = [];

  private points: THREE.Mesh[] = [];
  private outline: THREE.Line;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private activeIndex = -1;
  private baseHalf = new THREE.Vector3(0.5, 0.5, 0.5);
  private center = new THREE.Vector3();
  private basePos: Float32Array | null = null;
  private startCorners: Corner[] = [];

  constructor(
    private camera: THREE.Camera,
    private dom: HTMLElement,
    private onChange: () => void,
    private onDragStateChange: (dragging: boolean) => void,
  ) {
    this.group.visible = false;
    const geom = new THREE.SphereGeometry(0.07, 20, 14);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false }),
      );
      m.renderOrder = 999;
      m.userData['handleIndex'] = i;
      this.points.push(m);
      this.group.add(m);
    }

    const og = new THREE.BufferGeometry();
    og.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((SEG * 4 + 1) * 3), 3),
    );
    this.outline = new THREE.Line(
      og,
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    this.outline.renderOrder = 998;
    this.group.add(this.outline);

    dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  /* ------------------------------- state ------------------------------- */

  getState(): CageState {
    return {
      plane: this.plane,
      mode: this.mode,
      curve: this.curve,
      corners: this.corners.map((c) => ({ ...c })),
    };
  }

  setVisible(v: boolean) {
    this.group.visible = v && !!this.object;
    this.update();
  }

  setPlane(plane: HandlePlane) {
    this.plane = plane;
    this.saveState();
    this.resetCorners();
    this.applyDeform();
    this.update();
  }

  setMode(mode: HandleMode) {
    this.mode = mode;
    this.saveState();
  }

  setCurve(curve: number) {
    this.curve = curve;
    this.saveState();
    this.applyDeform();
    this.update();
    this.onChange();
  }

  reset() {
    this.curve = 0;
    this.resetCorners();
    this.saveState();
    this.applyDeform();
    this.update();
    this.onChange();
  }

  attach(object: THREE.Object3D | null) {
    const mesh = object && (object as THREE.Mesh).isMesh ? (object as THREE.Mesh) : null;
    this.object = mesh;
    this.basePos = null;
    if (mesh) {
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      let base = mesh.userData['basePositions'] as Float32Array | undefined;
      if (!base) {
        base = new Float32Array(pos.array as ArrayLike<number>);
        mesh.userData['basePositions'] = base;
      }
      this.basePos = base;

      const box = new THREE.Box3();
      const p = new THREE.Vector3();
      for (let i = 0; i < base.length; i += 3) {
        box.expandByPoint(p.set(base[i]!, base[i + 1]!, base[i + 2]!));
      }
      box.getCenter(this.center);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.baseHalf.set(
        Math.max(size.x / 2, 1e-4),
        Math.max(size.y / 2, 1e-4),
        Math.max(size.z / 2, 1e-4),
      );

      const saved = mesh.userData['cage'] as CageState | undefined;
      if (saved) {
        this.plane = saved.plane;
        this.mode = saved.mode;
        this.curve = saved.curve;
        this.corners = saved.corners.map((c) => ({ ...c }));
      } else {
        this.curve = 0;
        this.resetCorners();
        this.saveState();
      }
    }
    this.group.visible = !!mesh;
    this.update();
  }

  private saveState() {
    if (this.object) this.object.userData['cage'] = this.getState();
  }

  private resetCorners() {
    const [h, v] = AXES[this.plane];
    const hw = this.baseHalf[h];
    const vh = this.baseHalf[v];
    const ch = this.center[h];
    const cv = this.center[v];
    this.corners = [
      { h: ch - hw, v: cv - vh },
      { h: ch + hw, v: cv - vh },
      { h: ch + hw, v: cv + vh },
      { h: ch - hw, v: cv + vh },
    ];
  }

  /* ----------------------------- deformation ---------------------------- */

  /** Evaluate the curved cage at normalized (u, t) in [0,1]. */
  private evalCage(u: number, t: number, out: THREE.Vector2) {
    const c = this.corners;
    const p0 = new THREE.Vector2(c[0]!.h, c[0]!.v);
    const p1 = new THREE.Vector2(c[1]!.h, c[1]!.v);
    const p2 = new THREE.Vector2(c[2]!.h, c[2]!.v);
    const p3 = new THREE.Vector2(c[3]!.h, c[3]!.v);
    const mid = new THREE.Vector2()
      .addVectors(p0, p1)
      .add(p2)
      .add(p3)
      .multiplyScalar(0.25);

    const ctrl = (a: THREE.Vector2, b: THREE.Vector2) => {
      const m = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
      const away = new THREE.Vector2().subVectors(m, mid);
      if (away.lengthSq() < 1e-8) away.set(0, 1);
      away.normalize();
      const len = a.distanceTo(b);
      return m.addScaledVector(away, this.curve * len * 0.5);
    };

    const bottom = bez(p0, ctrl(p0, p1), p1, u, new THREE.Vector2());
    const top = bez(p3, ctrl(p3, p2), p2, u, new THREE.Vector2());
    const left = bez(p0, ctrl(p0, p3), p3, t, new THREE.Vector2());
    const right = bez(p1, ctrl(p1, p2), p2, t, new THREE.Vector2());

    const x =
      (1 - t) * bottom.x +
      t * top.x +
      (1 - u) * left.x +
      u * right.x -
      ((1 - u) * (1 - t) * p0.x + u * (1 - t) * p1.x + u * t * p2.x + (1 - u) * t * p3.x);
    const y =
      (1 - t) * bottom.y +
      t * top.y +
      (1 - u) * left.y +
      u * right.y -
      ((1 - u) * (1 - t) * p0.y + u * (1 - t) * p1.y + u * t * p2.y + (1 - u) * t * p3.y);

    return out.set(x, y);
  }

  /** Rewrite the mesh geometry from the untouched base vertices. */
  private applyDeform() {
    const mesh = this.object;
    const base = this.basePos;
    if (!mesh || !base) return;
    const attr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const [h, v] = AXES[this.plane];
    const idx: Record<Axis, number> = { x: 0, y: 1, z: 2 };
    const hi = idx[h];
    const vi = idx[v];
    const hw = this.baseHalf[h];
    const vh = this.baseHalf[v];
    const ch = this.center[h];
    const cv = this.center[v];
    const out = new THREE.Vector2();

    for (let i = 0; i < base.length; i += 3) {
      arr[i] = base[i]!;
      arr[i + 1] = base[i + 1]!;
      arr[i + 2] = base[i + 2]!;
      const u = clamp01((base[i + hi]! - ch) / (2 * hw) + 0.5);
      const t = clamp01((base[i + vi]! - cv) / (2 * vh) + 0.5);
      this.evalCage(u, t, out);
      arr[i + hi] = out.x;
      arr[i + vi] = out.y;
    }
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.userData['deformed'] = true;
  }

  /* ------------------------------- visuals ------------------------------ */

  /** Keep handles glued to the object's current transform. Call every frame. */
  update() {
    const obj = this.object;
    if (!obj || !this.group.visible) return;
    obj.updateMatrixWorld();
    this.group.position.setFromMatrixPosition(obj.matrixWorld);
    this.group.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()));

    const [h, v, n] = AXES[this.plane];
    const nc = this.center[n] * obj.scale[n];

    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const dist = camPos.distanceTo(this.group.position);
    const s = Math.max(0.35, dist * 0.05);

    this.points.forEach((p, i) => {
      const c = this.corners[i]!;
      p.position.set(0, 0, 0);
      p.position[h] = c.h * obj.scale[h];
      p.position[v] = c.v * obj.scale[v];
      p.position[n] = nc;
      p.scale.setScalar(s);
    });

    // curved outline through the 4 points
    const pos = this.outline.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const out = new THREE.Vector2();
    const edge = [
      [0, 0, 1, 0],
      [1, 0, 1, 1],
      [1, 1, 0, 1],
      [0, 1, 0, 0],
    ] as const;
    let w = 0;
    const push = (u: number, t: number) => {
      this.evalCage(u, t, out);
      const p = new THREE.Vector3();
      p[h] = out.x * obj.scale[h];
      p[v] = out.y * obj.scale[v];
      p[n] = nc;
      arr[w++] = p.x;
      arr[w++] = p.y;
      arr[w++] = p.z;
    };
    edge.forEach(([u0, t0, u1, t1]) => {
      for (let k = 0; k < SEG; k++) {
        const f = k / SEG;
        push(u0 + (u1 - u0) * f, t0 + (t1 - t0) * f);
      }
    });
    push(0, 0);
    pos.needsUpdate = true;
    this.outline.geometry.computeBoundingSphere();
  }

  /* ----------------------------- interaction ---------------------------- */

  private setPointer(e: PointerEvent) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.object || !this.group.visible) return;
    this.setPointer(e);
    const hit = this.raycaster.intersectObjects(this.points, false)[0];
    if (!hit) return;
    this.activeIndex = hit.object.userData['handleIndex'] as number;
    ((hit.object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(HANDLE_ACTIVE);
    const [, , n] = AXES[this.plane];
    const normal = new THREE.Vector3();
    normal[n] = 1;
    normal.applyQuaternion(this.group.quaternion).normalize();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, this.group.position);
    this.dragging = true;
    this.onDragStateChange(true);
    e.stopPropagation();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || !this.object || this.activeIndex < 0) return;
    this.setPointer(e);
    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hitPoint)) return;

    const local = this.group.worldToLocal(hitPoint.clone());
    const [h, v] = AXES[this.plane];
    const obj = this.object;
    const gh = local[h] / (obj.scale[h] || 1);
    const gv = local[v] / (obj.scale[v] || 1);
    const i = this.activeIndex;

    if (this.mode === "free") {
      this.corners[i] = { h: gh, v: gv };
    } else {
      const ch = this.center[h];
      const cv = this.center[v];
      const hw = Math.max(Math.abs(gh - ch), 0.02);
      const vh = Math.max(Math.abs(gv - cv), 0.02);
      this.corners = [
        { h: ch - hw, v: cv - vh },
        { h: ch + hw, v: cv - vh },
        { h: ch + hw, v: cv + vh },
        { h: ch - hw, v: cv + vh },
      ];
    }

    this.saveState();
    this.applyDeform();
    this.update();
    this.onChange();
  };

  private onPointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.activeIndex = -1;
    this.points.forEach((p) => {
      (p.material as THREE.MeshBasicMaterial).color.setHex(HANDLE_COLOR);
    });
    this.onDragStateChange(false);
    this.onChange();
  };

  dispose() {
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.points.forEach((p) => {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    });
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.group.clear();
  }
}
