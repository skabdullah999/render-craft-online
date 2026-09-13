import * as THREE from "three";

/** Which local plane the 4 corner points live on. */
export type HandlePlane = "xy" | "xz" | "zy";

const AXES: Record<HandlePlane, ["x" | "y" | "z", "x" | "y" | "z", "x" | "y" | "z"]> = {
  // [horizontal axis, vertical axis, plane normal axis]
  xy: ["x", "y", "z"],
  xz: ["x", "z", "y"],
  zy: ["z", "y", "x"],
};

const HANDLE_COLOR = 0xffb020;
const HANDLE_ACTIVE = 0x36d399;

/**
 * Shows 4 draggable corner points around the selected mesh.
 * Dragging a point resizes the object along the two axes of the active plane.
 */
export class BoxHandles {
  readonly group = new THREE.Group();
  dragging = false;

  private object: THREE.Mesh | null = null;
  private plane: HandlePlane = "xy";
  private points: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private activeIndex = -1;
  private baseHalf = new THREE.Vector3(0.5, 0.5, 0.5);
  private center = new THREE.Vector3();

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
    dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  setPlane(plane: HandlePlane) {
    this.plane = plane;
    this.update();
  }

  attach(object: THREE.Object3D | null) {
    const mesh = object && (object as THREE.Mesh).isMesh ? (object as THREE.Mesh) : null;
    this.object = mesh;
    if (mesh) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      box.getCenter(this.center);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.baseHalf.set(
        Math.max(size.x / 2, 1e-4),
        Math.max(size.y / 2, 1e-4),
        Math.max(size.z / 2, 1e-4),
      );
    }
    this.group.visible = !!mesh;
    this.update();
  }

  /** Keep handles glued to the object's current transform. Call every frame. */
  update() {
    const obj = this.object;
    if (!obj || !this.group.visible) return;
    obj.updateMatrixWorld();
    this.group.position.setFromMatrixPosition(obj.matrixWorld);
    this.group.quaternion.copy(obj.getWorldQuaternion(new THREE.Quaternion()));

    const [h, v, n] = AXES[this.plane];
    const hw = this.baseHalf[h] * obj.scale[h];
    const vh = this.baseHalf[v] * obj.scale[v];
    const nc = this.center[n] * obj.scale[n];
    const ch = this.center[h] * obj.scale[h];
    const cv = this.center[v] * obj.scale[v];

    const signs = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;

    // constant-ish screen size
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const dist = camPos.distanceTo(this.group.position);
    const s = Math.max(0.4, dist * 0.06);

    this.points.forEach((p, i) => {
      p.position.set(0, 0, 0);
      p.position[h] = ch + signs[i]![0] * hw;
      p.position[v] = cv + signs[i]![1] * vh;
      p.position[n] = nc;
      const inv = obj.scale;
      p.scale.set(s / (inv.x || 1), s / (inv.y || 1), s / (inv.z || 1));
      p.scale.set(s, s, s);
    });
  }

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
    (hit.object as THREE.Mesh).material = new THREE.MeshBasicMaterial({
      color: HANDLE_ACTIVE,
      depthTest: false,
    });
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
    if (!this.dragging || !this.object) return;
    this.setPointer(e);
    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hitPoint)) return;

    const local = this.group.worldToLocal(hitPoint.clone());
    const [h, v] = AXES[this.plane];
    const obj = this.object;

    const newHw = Math.max(Math.abs(local[h] - this.center[h] * obj.scale[h]), 0.02);
    const newVh = Math.max(Math.abs(local[v] - this.center[v] * obj.scale[v]), 0.02);

    obj.scale[h] = newHw / this.baseHalf[h];
    obj.scale[v] = newVh / this.baseHalf[v];

    this.update();
    this.onChange();
  };

  private onPointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.activeIndex = -1;
    this.points.forEach((p) => {
      p.material = new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false });
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
    this.group.clear();
  }
}
