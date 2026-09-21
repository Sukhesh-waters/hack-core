"use client";

import { useEffect, useRef, useState } from "react";
import {
  ambientParticles,
  arrivals,
  FLOW_BOUNDS,
  nodeRadius,
  STAGES,
  stageX,
  type FlowEdge,
  type FlowNode,
  type FlowStage,
} from "@/lib/platina/flow-graph";

export type BrainPoint = {
  id: string;
  kind: "claim" | "measured" | "event";
  recent: boolean;
};

type Three = typeof import("three");

/** Stage hues, tuned against the Platina light shell; the Brain takes the theme primary. */
const STAGE_COLOR: Record<FlowStage, string> = {
  sources: "#0f9d8a",
  collected: "#64748b",
  analysis: "#7c3aed",
  brain: "", // theme primary
  use: "#d97706",
  results: "#16a34a",
};
const KIND_COLOR: Record<BrainPoint["kind"], string> = {
  claim: "#7c3aed",
  measured: "#0f9d8a",
  event: "#d97706",
};
const BURST_COLOR = "#f59e0b";
const MAX_PARTICLES = 900;
const CURVE_SAMPLES = 48;

function cssHsl(el: Element, name: string, fallback: string): string {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/);
  return parts.length === 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : fallback;
}

type Particle = { edge: number; t: number; speed: number; burst: boolean };

type SceneState = {
  THREE: Three;
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  controls: { update: () => void; dispose: () => void; autoRotate: boolean };
  nodeMeshes: Map<string, import("three").Mesh>;
  edgeSamples: import("three").Vector3[][];
  edgeIds: string[];
  edgeGroup: import("three").Group;
  particles: Particle[];
  ambientPoints: import("three").Points;
  burstPoints: import("three").Points;
  cloud: import("three").Points | null;
  cloudGroup: import("three").Group;
  dot: import("three").Texture;
  primary: string;
  disposed: boolean;
};

/**
 * The live pipeline in 3D: sources -> collected -> AI analysis -> Brain
 * vectors -> use -> results. Every node, number and vector point is real
 * (see lib/platina/flow-graph.ts). Particles run along edges in proportion to
 * the last 24 h of traffic; when a refreshed snapshot shows new arrivals, a
 * burst travels exactly the edges that carried them.
 */
export function FlowScene({
  nodes,
  edges,
  brain,
  label,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  brain: BrainPoint[];
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const stageRefs = useRef(new Map<string, HTMLDivElement>());
  const stateRef = useRef<SceneState | null>(null);
  const prevEdgesRef = useRef<FlowEdge[] | null>(null);
  const latest = useRef({ nodes, edges, brain });
  latest.current = { nodes, edges, brain };
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported">("loading");
  const [lastBurst, setLastBurst] = useState<string | null>(null);

  // ---- one-time setup -----------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let visible = true;
    let onScreen = true;
    // Unmounted while three.js was still loading (or StrictMode's double
    // effect): never build a renderer and loop nobody will clean up.
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: (() => void)[] = [];

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled || !hostRef.current) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        setStatus("unsupported");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "block h-full w-full";
      host.prepend(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 200);
      // Fit the whole pipeline to the container width (and again on resize).
      const center = (FLOW_BOUNDS.minX + FLOW_BOUNDS.maxX) / 2;
      const fit = () => {
        const aspect = host.clientWidth / host.clientHeight;
        const vHalf = (camera.fov * Math.PI) / 360;
        const hHalf = Math.atan(Math.tan(vHalf) * aspect);
        const width = FLOW_BOUNDS.maxX - FLOW_BOUNDS.minX + 3;
        const height = FLOW_BOUNDS.maxY - FLOW_BOUNDS.minY + 3;
        const d = Math.max(width / 2 / Math.tan(hHalf), height / 2 / Math.tan(vHalf));
        camera.position.set(center, 1.2, d);
        camera.lookAt(center, 0, 0);
      };
      fit();
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.set(6, 10, 12);
      scene.add(sun);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(center, 0, 0);
      controls.minDistance = 10;
      controls.maxDistance = 60;
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = 0.35;
      // Stop the idle spin once someone takes the wheel.
      renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false), { once: true });

      // Soft round dots instead of GL's default squares (generated, no asset).
      const dotCanvas = document.createElement("canvas");
      dotCanvas.width = dotCanvas.height = 64;
      const g = dotCanvas.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.45, "rgba(255,255,255,0.85)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const dot = new THREE.CanvasTexture(dotCanvas);
      dot.colorSpace = THREE.SRGBColorSpace;

      const makePoints = (size: number) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
        geo.setDrawRange(0, 0);
        const pts = new THREE.Points(
          geo,
          new THREE.PointsMaterial({ size, map: dot, alphaTest: 0.05, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }),
        );
        scene.add(pts);
        return pts;
      };
      const primary = cssHsl(host.closest(".platina-shell") ?? document.documentElement, "--primary", "#0b5cad");
      const ambientPoints = makePoints(0.32);
      (ambientPoints.material as import("three").PointsMaterial).color = new THREE.Color(primary);
      const burstPoints = makePoints(0.6);
      (burstPoints.material as import("three").PointsMaterial).color = new THREE.Color(BURST_COLOR);

      const state: SceneState = {
        THREE,
        renderer,
        scene,
        camera,
        controls,
        nodeMeshes: new Map(),
        edgeSamples: [],
        edgeIds: [],
        edgeGroup: new THREE.Group(),
        particles: [],
        ambientPoints,
        burstPoints,
        cloud: null,
        cloudGroup: new THREE.Group(),
        dot,
        primary,
        disposed: false,
      };
      scene.add(state.edgeGroup, state.cloudGroup);
      stateRef.current = state;
      applyGraph(state, latest.current.nodes, latest.current.edges, latest.current.brain, null);
      prevEdgesRef.current = latest.current.edges;
      setStatus("ready");

      const resize = new ResizeObserver(() => {
        if (!host.clientWidth || !host.clientHeight) return;
        renderer.setSize(host.clientWidth, host.clientHeight);
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.updateProjectionMatrix();
        // Refit only until someone has moved the camera themselves.
        if (controls.autoRotate) {
          fit();
          controls.target.set(center, 0, 0);
        }
      });
      resize.observe(host);
      const seen = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
      seen.observe(host);
      const onVisibility = () => (visible = !document.hidden);
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => {
        resize.disconnect();
        seen.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
      });

      const clock = new THREE.Clock();
      const projected = new THREE.Vector3();
      const tick = () => {
        if (cancelled) return;
        frame = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.1);
        // Nothing to draw for nobody: hidden tab or scrolled away.
        if (!visible || !onScreen) return;
        controls.update();
        if (!reduced) {
          stepParticles(state, dt);
          state.cloudGroup.rotation.y += dt * 0.12;
        }
        renderer.render(scene, camera);
        // HTML labels follow their nodes.
        const w = host.clientWidth;
        const h = host.clientHeight;
        for (const stage of STAGES) {
          const el = stageRefs.current.get(stage.id);
          if (!el) continue;
          projected.set(stageX(stage.id), FLOW_BOUNDS.maxY + 0.6, 0).project(camera);
          el.style.transform = `translate(-50%, -50%) translate(${((projected.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-projected.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
          el.style.opacity = projected.z < 1 ? "1" : "0";
        }
        for (const [id, mesh] of state.nodeMeshes) {
          const el = labelRefs.current.get(id);
          if (!el) continue;
          projected.copy(mesh.position).project(camera);
          const x = (projected.x * 0.5 + 0.5) * w;
          const y = (-projected.y * 0.5 + 0.5) * h;
          // Below the sphere, clear of it at any zoom.
          const below = (mesh.scale.x / Math.max(1, camera.position.distanceTo(mesh.position))) * h * 1.25 + 4;
          el.style.transform = `translate(-50%, 0) translate(${x.toFixed(1)}px, ${(y + below).toFixed(1)}px)`;
          el.style.opacity = projected.z < 1 ? "1" : "0";
        }
      };
      tick();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      for (const c of cleanups) c();
      const s = stateRef.current;
      if (s) {
        s.disposed = true;
        s.controls.dispose();
        s.scene.traverse((o) => {
          const mesh = o as import("three").Mesh;
          mesh.geometry?.dispose?.();
          const m = mesh.material as import("three").Material | import("three").Material[] | undefined;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose?.();
        });
        s.dot.dispose();
        s.renderer.dispose();
        s.renderer.domElement.remove();
      }
      stateRef.current = null;
    };
  }, []);

  // ---- new snapshot (router refresh after a live signal) -------------------
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const fired = arrivals(prevEdgesRef.current, edges);
    applyGraph(s, nodes, edges, brain, fired);
    prevEdgesRef.current = edges;
    if (fired.size > 0) {
      const total = [...fired.values()].reduce((a, b) => a + b, 0);
      setLastBurst(`${total} new item${total === 1 ? "" : "s"} just moved through the flow`);
    }
  }, [nodes, edges, brain]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className="relative h-[560px] w-full overflow-hidden rounded-lg border border-border bg-gradient-to-b from-card to-accent/40"
    >
      {STAGES.map((stage) => (
        <div
          key={stage.id}
          ref={(el) => {
            if (el) stageRefs.current.set(stage.id, el);
            else stageRefs.current.delete(stage.id);
          }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-primary opacity-0"
        >
          {stage.label}
        </div>
      ))}
      {nodes.map((n) => (
        <div
          key={n.id}
          ref={(el) => {
            if (el) labelRefs.current.set(n.id, el);
            else labelRefs.current.delete(n.id);
          }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-center opacity-0"
        >
          <span className="block text-xs font-medium text-foreground">
            {n.label} <span className="font-mono text-muted-foreground">{n.value.toLocaleString()}</span>
          </span>
          <span className="block max-w-[150px] truncate text-[10px] text-muted-foreground">{n.caption}</span>
        </div>
      ))}
      {status === "loading" ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Drawing the live flow…</p>
      ) : null}
      {status === "unsupported" ? (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
          This browser cannot draw 3D (WebGL is off). The same numbers are listed below.
        </p>
      ) : null}
      {lastBurst ? (
        <p aria-live="polite" className="absolute bottom-3 left-3 rounded-full border border-border bg-card/90 px-3 py-1 text-xs">
          {lastBurst}
        </p>
      ) : null}
      <p className="absolute bottom-3 right-3 text-[10px] text-muted-foreground">Drag to turn · scroll to zoom</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene updates (imperative; three.js objects live outside React state)
// ---------------------------------------------------------------------------

function applyGraph(
  s: SceneState,
  nodes: FlowNode[],
  edges: FlowEdge[],
  brain: BrainPoint[],
  fired: Map<string, number> | null,
) {
  const { THREE } = s;
  // Nodes: create once, rescale on new counts.
  for (const n of nodes) {
    let mesh = s.nodeMeshes.get(n.id);
    if (!mesh) {
      const color = new THREE.Color(STAGE_COLOR[n.stage] || s.primary);
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 24),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.1 }),
      );
      mesh.position.set(...n.position);
      s.scene.add(mesh);
      s.nodeMeshes.set(n.id, mesh);
    }
    const r = nodeRadius(n.value);
    mesh.scale.setScalar(r);
  }

  // Edges: rebuild only when the set of edges changes (it rarely does).
  const ids = edges.map((e) => e.id);
  if (ids.join("|") !== s.edgeIds.join("|")) {
    s.edgeGroup.children.forEach((c) => {
      const line = c as import("three").Line;
      line.geometry.dispose();
      (line.material as import("three").Material).dispose();
    });
    s.edgeGroup.clear();
    s.edgeSamples = edges.map((e) => {
      const a = s.nodeMeshes.get(e.from)!.position;
      const b = s.nodeMeshes.get(e.to)!.position;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += e.feedback ? -3.2 : 0.9;
      mid.z += e.feedback ? 2.5 : 1.2;
      const points = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone()).getSpacedPoints(CURVE_SAMPLES);
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = e.feedback
        ? new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x16a34a, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.6 }))
        : new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 }));
      if (e.feedback) line.computeLineDistances();
      s.edgeGroup.add(line);
      return points;
    });
    s.edgeIds = ids;
  }

  // Ambient particles follow the 24 h rate; bursts are added on top.
  s.particles = s.particles.filter((p) => p.burst);
  edges.forEach((e, i) => {
    const n = ambientParticles(e.rate);
    for (let k = 0; k < n; k++) s.particles.push({ edge: i, t: k / n, speed: 0.08 + Math.random() * 0.05, burst: false });
  });
  if (fired) {
    for (const [edgeId, count] of fired) {
      const i = ids.indexOf(edgeId);
      if (i < 0) continue;
      for (let k = 0; k < count; k++) s.particles.push({ edge: i, t: -k * 0.07, speed: 0.35, burst: true });
    }
  }
  s.particles = s.particles.slice(-MAX_PARTICLES);

  // Brain: one point per stored vector, on a sphere around the Brain node.
  const brainMesh = s.nodeMeshes.get("brain");
  if (brainMesh) {
    if (s.cloud) {
      s.cloud.geometry.dispose();
      (s.cloud.material as import("three").Material).dispose();
      s.cloudGroup.remove(s.cloud);
    }
    const n = brain.length;
    const radius = brainMesh.scale.x + 1.1;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere: even spread, stable position per index.
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      pos.set([Math.cos(phi) * r * radius, y * radius, Math.sin(phi) * r * radius], i * 3);
      c.set(KIND_COLOR[brain[i].kind]);
      if (!brain[i].recent) c.lerp(new THREE.Color(0xcbd5e1), 0.45);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    s.cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.3, map: s.dot, alphaTest: 0.05, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    s.cloudGroup.position.copy(brainMesh.position);
    s.cloudGroup.add(s.cloud);
  }
  writeParticles(s);
}

function stepParticles(s: SceneState, dt: number) {
  for (const p of s.particles) p.t += p.speed * dt;
  // Bursts end at their destination; ambient particles loop.
  s.particles = s.particles.filter((p) => !(p.burst && p.t >= 1));
  for (const p of s.particles) if (!p.burst && p.t >= 1) p.t -= 1;
  writeParticles(s);
}

function writeParticles(s: SceneState) {
  const write = (points: import("three").Points, list: Particle[]) => {
    const attr = points.geometry.getAttribute("position") as import("three").BufferAttribute;
    let n = 0;
    for (const p of list) {
      if (p.t < 0) continue;
      const samples = s.edgeSamples[p.edge];
      if (!samples) continue;
      const f = Math.min(p.t, 0.999) * CURVE_SAMPLES;
      const i = Math.floor(f);
      const a = samples[i];
      const b = samples[i + 1] ?? a;
      const k = f - i;
      attr.setXYZ(n, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      n += 1;
    }
    attr.needsUpdate = true;
    points.geometry.setDrawRange(0, n);
  };
  write(s.ambientPoints, s.particles.filter((p) => !p.burst));
  write(s.burstPoints, s.particles.filter((p) => p.burst));
}
