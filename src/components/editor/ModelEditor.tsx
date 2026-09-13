import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  Box,
  Circle,
  Cone,
  Cylinder,
  Donut,
  Sun,
  Lightbulb,
  Flashlight,
  Sparkles,
  Move3d,
  Rotate3d,
  Scaling,
  Trash2,
  Copy,
  Download,
  Grid3x3,
  Square,
  Hexagon,
  Pill,
  Triangle,
  Code2,
  Spline,
  RotateCcw,
  Frame,
} from "lucide-react";
import {
  GEOMETRY_SPECS,
  createGeometry,
  isLight,
  labelFor,
  type Kind,
  type MeshKind,
} from "./geometry";
import { generateThreeCode } from "./exportCode";
import { BoxHandles, type HandleMode, type HandlePlane } from "./handles";
import ColorPicker from "./ColorPicker";

type Item = { id: string; name: string; kind: Kind };
type Mode = "translate" | "rotate" | "scale";

const BG = "#14161a";

const MESH_ICONS: Partial<Record<MeshKind, typeof Box>> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  cone: Cone,
  torus: Donut,
  torusKnot: Sparkles,
  plane: Square,
  icosahedron: Hexagon,
  capsule: Pill,
  ring: Circle,
  dodecahedron: Hexagon,
  tetrahedron: Triangle,
};

const LIGHT_ICONS = {
  directionalLight: Sun,
  pointLight: Lightbulb,
  spotLight: Flashlight,
  ambientLight: Sparkles,
} as const;

let counter = 0;
const nextId = () => `obj_${++counter}_${Math.random().toString(36).slice(2, 6)}`;

export default function ModelEditor() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const objectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const selectedRef = useRef<string | null>(null);
  const handlesRef = useRef<BoxHandles | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("translate");
  const [showGrid, setShowGrid] = useState(true);
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((t) => t + 1), []);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pointsOn, setPointsOn] = useState(false);
  const [handlePlane, setHandlePlane] = useState<HandlePlane>("xy");
  const [handleMode, setHandleMode] = useState<HandleMode>("linked");
  const [curve, setCurve] = useState(0);

  selectedRef.current = selected;

  /* ---------------- three.js bootstrap ---------------- */
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(5, 4, 7);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(40, 40, 0x4b5563, 0x272b31);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);
    gridRef.current = grid;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.5, 0);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      if (!e.value) tick();
    });
    transform.addEventListener("objectChange", tick);
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const handles = new BoxHandles(camera, renderer.domElement, tick, (d) => {
      orbit.enabled = !d;
      transform.enabled = !d;
    });
    scene.add(handles.group);
    handlesRef.current = handles;

    // viewport helper lights so the scene is never pitch black
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20242b, 0.55);
    scene.add(hemi);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (transform.dragging || handles.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targets = [...objectsRef.current.entries()];
      const hits = raycaster.intersectObjects(
        targets.map(([, o]) => o),
        true,
      );
      if (hits.length) {
        let obj: THREE.Object3D | null = hits[0]!.object;
        while (obj && !targets.some(([, o]) => o === obj)) obj = obj.parent;
        const entry = targets.find(([, o]) => o === obj);
        setSelected(entry ? entry[0] : null);
      } else {
        setSelected(null);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    renderer.setAnimationLoop(() => {
      orbit.update();
      handles.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      handles.dispose();
      transform.detach();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [tick]);

  /* ---------------- selection + gizmo sync ---------------- */
  useEffect(() => {
    const t = transformRef.current;
    if (!t) return;
    const obj = selected ? objectsRef.current.get(selected) : null;
    if (obj) t.attach(obj);
    else t.detach();
  }, [selected, items]);

  useEffect(() => {
    transformRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  /* ---------------- point cage sync ---------------- */
  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    const obj = pointsOn && selected ? (objectsRef.current.get(selected) ?? null) : null;
    h.attach(obj);
    h.setMode(handleMode);
    h.setVisible(pointsOn);
    if (obj) {
      const st = h.getState();
      setHandlePlane(st.plane);
      setCurve(st.curve);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pointsOn, items]);

  useEffect(() => {
    handlesRef.current?.setMode(handleMode);
  }, [handleMode]);

  useEffect(() => {
    if (pointsOn) handlesRef.current?.setPlane(handlePlane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePlane]);

  useEffect(() => {
    if (pointsOn) handlesRef.current?.setCurve(curve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve]);

  /* ---------------- object operations ---------------- */
  const addObject = useCallback((kind: Kind, source?: THREE.Object3D) => {
    const scene = sceneRef.current!;
    let obj: THREE.Object3D;

    if (isLight(kind)) {
      if (kind === "ambientLight") obj = new THREE.AmbientLight(0xffffff, 0.4);
      else if (kind === "directionalLight") obj = new THREE.DirectionalLight(0xffffff, 2.2);
      else if (kind === "pointLight") obj = new THREE.PointLight(0xffe6b0, 12, 0, 2);
      else obj = new THREE.SpotLight(0xffffff, 25, 0, Math.PI / 6, 0.35);
      obj.position.set(3, 4, 2);
      if (kind !== "ambientLight") (obj as THREE.Light).castShadow = true;
    } else {
      const mesh = new THREE.Mesh(
        createGeometry(kind),
        new THREE.MeshStandardMaterial({
          color: 0xb9bec7,
          metalness: 0.1,
          roughness: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.y = 0.75;
      obj = mesh;
    }

    if (source) {
      obj.position.copy(source.position);
      obj.rotation.copy(source.rotation);
      obj.scale.copy(source.scale);
      obj.position.x += 1;
      const sm = (source as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      const om = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (sm && om) {
        om.color.copy(sm.color);
        om.metalness = sm.metalness;
        om.roughness = sm.roughness;
        om.wireframe = sm.wireframe;
        om.flatShading = sm.flatShading;
        om.needsUpdate = true;
      }
    }

    const id = nextId();
    objectsRef.current.set(id, obj);
    scene.add(obj);
    setItems((prev) => {
      const same = prev.filter((p) => p.kind === kind).length;
      return [...prev, { id, name: `${labelFor(kind)}${same ? `.${same}` : ""}`, kind }];
    });
    setSelected(id);
    return id;
  }, []);

  const removeSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    const obj = objectsRef.current.get(id);
    if (obj) {
      transformRef.current?.detach();
      sceneRef.current?.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
      objectsRef.current.delete(id);
    }
    setItems((prev) => prev.filter((p) => p.id !== id));
    setSelected(null);
  }, []);

  const duplicateSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    const item = items.find((i) => i.id === id);
    const obj = objectsRef.current.get(id);
    if (item && obj) addObject(item.kind, obj);
  }, [items, addObject]);

  /* ---------------- keyboard shortcuts ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "g") setMode("translate");
      else if (k === "r") setMode("rotate");
      else if (k === "s") setMode("scale");
      else if (k === "x" || k === "delete") removeSelected();
      else if (k === "d" && e.shiftKey) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeSelected, duplicateSelected]);

  /* ---------------- default starter scene ---------------- */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const cube = addObject("box");
    addObject("directionalLight");
    addObject("ambientLight");
    setSelected(cube);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  /* ---------------- code export ---------------- */
  const code = useMemo(() => {
    const list = items
      .map((i) => ({ ...i, object: objectsRef.current.get(i.id)! }))
      .filter((i) => i.object);
    return generateThreeCode(list, BG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, codeOpen, selected, forceTick]);

  const download = () => {
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.js";
    a.click();
    URL.revokeObjectURL(url);
  };

  const selItem = items.find((i) => i.id === selected) ?? null;
  const selObj = selected ? (objectsRef.current.get(selected) ?? null) : null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-semibold tracking-tight">Lovable Modeler</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          G move · R rotate · S scale · Shift+D duplicate · X delete
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCodeOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Code2 className="size-3.5" /> {codeOpen ? "Hide code" : "View code"}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="size-3.5" /> Download scene.js
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left toolshelf */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-border bg-card p-2">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Add mesh
          </p>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(GEOMETRY_SPECS) as MeshKind[]).map((k) => {
              const Icon = MESH_ICONS[k] ?? Box;
              return (
                <button
                  key={k}
                  title={GEOMETRY_SPECS[k].label}
                  onClick={() => addObject(k)}
                  className="flex aspect-square items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Add light
          </p>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(LIGHT_ICONS) as (keyof typeof LIGHT_ICONS)[]).map((k) => {
              const Icon = LIGHT_ICONS[k];
              return (
                <button
                  key={k}
                  onClick={() => addObject(k)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{labelFor(k).split(" ")[0]}</span>
                </button>
              );
            })}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Transform
          </p>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ["translate", Move3d],
                ["rotate", Rotate3d],
                ["scale", Scaling],
              ] as const
            ).map(([m, Icon]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex aspect-square items-center justify-center rounded-md border transition-colors ${
                  mode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>

          <p className="px-1 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Point cage
          </p>
          <div className="space-y-1">
            <button
              onClick={() => setPointsOn((v) => !v)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                pointsOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Frame className="size-3.5" /> {pointsOn ? "Points on" : "4 points"}
            </button>

            {pointsOn && (
              <>
                <div className="grid grid-cols-3 gap-1">
                  {(["xy", "xz", "zy"] as HandlePlane[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setHandlePlane(p)}
                      className={`rounded-md border py-1 text-[10px] uppercase transition-colors ${
                        handlePlane === p
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ["linked", "Linked"],
                      ["free", "Free"],
                    ] as [HandleMode, string][]
                  ).map(([m, lbl]) => (
                    <button
                      key={m}
                      onClick={() => setHandleMode(m)}
                      className={`rounded-md border py-1 text-[10px] transition-colors ${
                        handleMode === m
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <label className="block px-0.5 pt-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1">
                      <Spline className="size-3" /> Curve
                    </span>
                    <span className="font-mono">{curve.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={curve}
                    onChange={(e) => setCurve(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-primary"
                  />
                </label>
                <button
                  onClick={() => {
                    handlesRef.current?.reset();
                    setCurve(0);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" /> Reset shape
                </button>
              </>
            )}
          </div>

          <div className="mt-4 space-y-1">
            <button
              onClick={duplicateSelected}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3.5" /> Duplicate
            </button>
            <button
              onClick={removeSelected}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
            <button
              onClick={() => setShowGrid((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Grid3x3 className="size-3.5" /> {showGrid ? "Hide grid" : "Show grid"}
            </button>
          </div>
        </aside>

        {/* viewport */}
        <main className="relative min-w-0 flex-1">
          <div ref={mountRef} className="absolute inset-0" />
          {codeOpen && (
            <div className="absolute inset-y-0 right-0 z-10 w-[min(560px,60%)] overflow-auto border-l border-border bg-card/95 p-4 backdrop-blur">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {code}
              </pre>
            </div>
          )}
        </main>

        {/* right panels */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-card">
          <div className="max-h-56 overflow-y-auto border-b border-border p-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Outliner
            </p>
            {items.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Scene is empty.</p>
            )}
            {items.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelected(i.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                  selected === i.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span className="truncate">{i.name}</span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Properties
            </p>
            {!selItem || !selObj ? (
              <p className="text-xs text-muted-foreground">Select an object in the viewport.</p>
            ) : (
              <ObjectProperties key={selItem.id} item={selItem} object={selObj} onChange={tick} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ObjectProperties({
  item,
  object,
  onChange,
}: {
  item: Item;
  object: THREE.Object3D;
  onChange: () => void;
}) {
  const light = isLight(item.kind) ? (object as THREE.Light) : null;
  const mat = !light ? ((object as THREE.Mesh).material as THREE.MeshStandardMaterial) : null;

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium">{item.name}</div>

      {item.kind !== "ambientLight" && (
        <Vec3Row label="Location" v={object.position} step={0.1} onChange={onChange} />
      )}
      {!light && (
        <>
          <Vec3Row label="Rotation" v={object.rotation} step={0.05} onChange={onChange} />
          <Vec3Row label="Scale" v={object.scale} step={0.05} onChange={onChange} />
        </>
      )}

      {mat && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Material
          </p>
          <ColorPicker
            label="Base color"
            value={`#${mat.color.getHexString()}`}
            onChange={(hex) => {
              mat.color.set(hex);
              onChange();
            }}
          />
          <SliderRow
            label="Metallic"
            value={mat.metalness}
            onChange={(v) => {
              mat.metalness = v;
              onChange();
            }}
          />
          <SliderRow
            label="Roughness"
            value={mat.roughness}
            onChange={(v) => {
              mat.roughness = v;
              onChange();
            }}
          />
          <ToggleRow
            label="Wireframe"
            value={mat.wireframe}
            onChange={(v) => {
              mat.wireframe = v;
              onChange();
            }}
          />
          <ToggleRow
            label="Flat shading"
            value={mat.flatShading}
            onChange={(v) => {
              mat.flatShading = v;
              mat.needsUpdate = true;
              onChange();
            }}
          />
        </div>
      )}

      {light && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Light
          </p>
          <ColorPicker
            label="Light color"
            value={`#${light.color.getHexString()}`}
            onChange={(hex) => {
              light.color.set(hex);
              onChange();
            }}
          />
          <SliderRow
            label="Power"
            max={item.kind === "pointLight" || item.kind === "spotLight" ? 60 : 10}
            value={light.intensity}
            onChange={(v) => {
              light.intensity = v;
              onChange();
            }}
          />
        </div>
      )}
    </div>
  );
}

function Vec3Row({
  label,
  v,
  step,
  onChange,
}: {
  label: string;
  v: THREE.Vector3 | THREE.Euler;
  step: number;
  onChange: () => void;
}) {
  const axes = ["x", "y", "z"] as const;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((a) => (
          <div key={a} className="flex items-center rounded border border-border bg-secondary px-1">
            <span className="pr-1 text-[10px] uppercase text-muted-foreground">{a}</span>
            <input
              type="number"
              step={step}
              value={Number(v[a].toFixed(3))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isNaN(n)) {
                  v[a] = n;
                  onChange();
                }
              }}
              className="w-full bg-transparent py-1 text-[11px] outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-[10px]">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={max / 100}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-primary"
      />
    </label>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-muted-foreground">
      {label}
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-primary"
      />
    </label>
  );
}
