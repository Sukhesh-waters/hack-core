"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapLink, MapNode, MapNodeKind } from "@/lib/platina/brain-map";
import { cn } from "@/lib/utils";

const KIND: Record<MapNodeKind, { label: string; color: string; size: number; tone: string }> = {
  client: { label: "Client", color: "#0176D3", size: 1.7, tone: "bg-[#0176D3]" },
  competitor: { label: "Competitors", color: "#e11d48", size: 1.15, tone: "bg-[#e11d48]" },
  topic: { label: "Subjects", color: "#00A1E0", size: 0.62, tone: "bg-[#00A1E0]" },
  event: { label: "Events", color: "#d97706", size: 0.8, tone: "bg-[#d97706]" },
  insight: { label: "AI insights", color: "#7c3aed", size: 0.45, tone: "bg-[#7c3aed]" },
  source: { label: "Sources", color: "#64748b", size: 0.34, tone: "bg-[#64748b]" },
};
const KINDS = Object.keys(KIND) as MapNodeKind[];
/** Always-named nodes (the rest are named on hover). */
const NAMED: MapNodeKind[] = ["client", "competitor", "event"];

type Scene = {
  THREE: typeof import("three");
  camera: import("three").PerspectiveCamera;
  controls: { target: import("three").Vector3; update: () => void; autoRotate: boolean; dispose: () => void };
  meshes: Map<string, import("three").Mesh>;
  highlight: import("three").LineSegments;
  base: import("three").LineSegments;
};

/**
 * The Brain map (C8.6): every company, subject, event, source and AI insight
 * as a connected 3D graph. Positions come from the server's deterministic
 * layout; this component only draws, picks and explains. Click a node for
 * its full text and every link as a sentence; search flies to it.
 */
export function BrainMapScene({ nodes, links }: { nodes: MapNode[]; links: MapLink[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<MapNodeKind>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported">("loading");

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbours = useMemo(() => {
    const m = new Map<string, { other: string; sentence: string }[]>();
    for (const l of links) {
      m.set(l.a, [...(m.get(l.a) ?? []), { other: l.b, sentence: l.sentence }]);
      m.set(l.b, [...(m.get(l.b) ?? []), { other: l.a, sentence: l.sentence }]);
    }
    return m;
  }, [links]);
  const selectRef = useRef(setSelected);
  selectRef.current = setSelected;

  // Build the scene once per data set.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let frame = 0;
    const cleanups: (() => void)[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled) return;
      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        setStatus("unsupported");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.className = "block h-full w-full";
      renderer.domElement.setAttribute("aria-hidden", "true");
      host.prepend(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 400);
      camera.position.set(0, 14, 62);
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.set(20, 30, 25);
      scene.add(sun);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = !reduced;
      controls.autoRotateSpeed = 0.4;
      controls.minDistance = 6;
      controls.maxDistance = 140;
      renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false), { once: true });

      const sphere = new THREE.SphereGeometry(1, 18, 14);
      const materials = new Map(
        KINDS.map((k) => [k, new THREE.MeshStandardMaterial({ color: KIND[k].color, roughness: 0.45, metalness: 0.1 })]),
      );
      const meshes = new Map<string, import("three").Mesh>();
      for (const n of nodes) {
        const mesh = new THREE.Mesh(sphere, materials.get(n.kind)!);
        const s = KIND[n.kind].size * (1 + n.weight * 0.05);
        mesh.scale.setScalar(s);
        mesh.position.set(n.x, n.y, n.z);
        mesh.userData.id = n.id;
        scene.add(mesh);
        meshes.set(n.id, mesh);
      }

      const lineGeometry = (subset: MapLink[]) => {
        const pts = new Float32Array(subset.length * 6);
        subset.forEach((l, i) => {
          const a = byId.get(l.a)!;
          const b = byId.get(l.b)!;
          pts.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
        return g;
      };
      const base = new THREE.LineSegments(
        lineGeometry(links),
        new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.28 }),
      );
      scene.add(base);
      const highlight = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x0176d3, transparent: true, opacity: 0.95 }),
      );
      scene.add(highlight);

      sceneRef.current = { THREE, camera, controls, meshes, highlight, base };

      // Always-visible names for companies and events, placed each frame.
      const named = nodes.filter((n) => NAMED.includes(n.kind));
      const labelEls = new Map<string, HTMLSpanElement>();
      for (const n of named) {
        const el = document.createElement("span");
        el.textContent = n.label;
        el.className =
          n.kind === "event"
            ? "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded bg-card/80 px-1 text-[10px] text-amber-700"
            : "pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded bg-card/85 px-1.5 text-xs font-medium text-foreground";
        labelsRef.current?.appendChild(el);
        labelEls.set(n.id, el);
      }
      cleanups.push(() => labelEls.forEach((el) => el.remove()));

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let hover: string | null = null;
      const pick = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects([...meshes.values()].filter((m) => m.visible))[0];
        return { id: (hit?.object.userData.id as string | undefined) ?? null, x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const onMove = (event: PointerEvent) => {
        const { id, x, y } = pick(event);
        hover = id;
        const tip = tipRef.current;
        if (!tip) return;
        if (!id) {
          tip.hidden = true;
          renderer.domElement.style.cursor = "";
          return;
        }
        const n = byId.get(id)!;
        tip.hidden = false;
        tip.textContent = `${KIND[n.kind].label.replace(/s$/, "")}: ${n.label}`;
        tip.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
        renderer.domElement.style.cursor = "pointer";
      };
      const onClick = (event: PointerEvent) => {
        const { id } = pick(event);
        if (id) selectRef.current(id);
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("click", onClick as (e: MouseEvent) => void);
      cleanups.push(() => {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("click", onClick as (e: MouseEvent) => void);
      });

      const onResize = () => {
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener("resize", onResize);
      cleanups.push(() => window.removeEventListener("resize", onResize));

      const v = new THREE.Vector3();
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (document.hidden) return;
        controls.update();
        for (const [id, el] of labelEls) {
          const mesh = meshes.get(id)!;
          v.copy(mesh.position).project(camera);
          const behind = v.z > 1 || !mesh.visible;
          el.hidden = behind;
          if (!behind) {
            el.style.transform = `translate(${((v.x + 1) / 2) * host.clientWidth + 8}px, ${((1 - v.y) / 2) * host.clientHeight - 8}px)`;
          }
        }
        for (const [id, mesh] of meshes) {
          const target = id === hover ? 1.35 : 1;
          const s = mesh.userData.base ?? (mesh.userData.base = mesh.scale.x);
          mesh.scale.setScalar(s * target);
        }
        renderer.render(scene, camera);
      };
      loop();
      setStatus("ready");

      cleanups.push(() => {
        controls.dispose();
        sphere.dispose();
        materials.forEach((m) => m.dispose());
        base.geometry.dispose();
        highlight.geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cleanups.forEach((c) => c());
      sceneRef.current = null;
    };
  }, [nodes, links, byId]);

  // Selection: highlight its links and fly to it.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const mine = selected ? links.filter((l) => l.a === selected || l.b === selected) : [];
    const pts = new Float32Array(mine.length * 6);
    mine.forEach((l, i) => {
      const a = byId.get(l.a)!;
      const b = byId.get(l.b)!;
      pts.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    s.highlight.geometry.dispose();
    s.highlight.geometry = new s.THREE.BufferGeometry();
    s.highlight.geometry.setAttribute("position", new s.THREE.BufferAttribute(pts, 3));
    const n = selected ? byId.get(selected) : null;
    if (!n) return;
    s.controls.autoRotate = false;
    const from = s.controls.target.clone();
    const to = new s.THREE.Vector3(n.x, n.y, n.z);
    const camFrom = s.camera.position.clone();
    const dir = camFrom.clone().sub(from).normalize();
    const camTo = to.clone().add(dir.multiplyScalar(n.kind === "client" ? 40 : 18));
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      s.controls.target.lerpVectors(from, to, e);
      s.camera.position.lerpVectors(camFrom, camTo, e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selected, links, byId]);

  // Kind filters.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    for (const [id, mesh] of s.meshes) mesh.visible = !hidden.has(byId.get(id)!.kind);
    const shown = links.filter((l) => !hidden.has(byId.get(l.a)!.kind) && !hidden.has(byId.get(l.b)!.kind));
    const pts = new Float32Array(shown.length * 6);
    shown.forEach((l, i) => {
      const a = byId.get(l.a)!;
      const b = byId.get(l.b)!;
      pts.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    s.base.geometry.dispose();
    s.base.geometry = new s.THREE.BufferGeometry();
    s.base.geometry.setAttribute("position", new s.THREE.BufferAttribute(pts, 3));
  }, [hidden, links, byId, status]);

  const matches = query.trim().length >= 2 ? nodes.filter((n) => n.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const sel = selected ? byId.get(selected) : null;
  const counts = KINDS.map((k) => [k, nodes.filter((n) => n.kind === k).length] as const);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="relative h-[72vh] min-h-[420px] overflow-hidden rounded-lg border border-border bg-gradient-to-b from-card to-muted/40">
        <div ref={hostRef} className="absolute inset-0" />
        <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
        <div ref={tipRef} hidden className="pointer-events-none absolute left-0 top-0 max-w-xs rounded border border-border bg-card px-2 py-1 text-xs shadow" />
        {status === "loading" ? <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Drawing the map…</p> : null}
        {status === "unsupported" ? (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            This browser cannot draw 3D (WebGL is off). The panel on the right still lists every node and link.
          </p>
        ) : null}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {counts.map(([k, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setHidden((h) => { const next = new Set(h); if (next.has(k)) next.delete(k); else next.add(k); return next; })}
              className={cn(
                "flex items-center gap-1.5 rounded-full border bg-card/90 px-2 py-0.5 text-[11px]",
                hidden.has(k) ? "border-border text-muted-foreground line-through" : "border-border text-foreground",
              )}
              aria-pressed={!hidden.has(k)}
            >
              <span className={cn("h-2 w-2 rounded-full", KIND[k].tone)} aria-hidden />
              {KIND[k].label} {n}
            </button>
          ))}
        </div>
      </div>

      <aside className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4">
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Find anything in the map</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ARABLAB, PFAS, Agilent…"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </label>
        {matches.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setSelected(m.id)} className="text-left text-primary hover:underline">
                  {m.label}
                </button>{" "}
                <span className="text-xs text-muted-foreground">{KIND[m.kind].label.replace(/s$/, "")}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {sel ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{KIND[sel.kind].label.replace(/s$/, "")}</p>
            <h2 className="font-medium">{sel.label}</h2>
            {sel.text && sel.text !== sel.label ? <p className="whitespace-pre-line text-sm text-muted-foreground">{sel.text}</p> : null}
            {sel.url ? (
              <a href={sel.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                Open the source ↗
              </a>
            ) : null}
            <p className="pt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Connections · {(neighbours.get(sel.id) ?? []).length}
            </p>
            <ul className="space-y-1.5 text-sm">
              {(neighbours.get(sel.id) ?? []).slice(0, 40).map(({ other, sentence }, i) => {
                const o = byId.get(other)!;
                return (
                  <li key={`${other}-${i}`}>
                    <span className="text-muted-foreground">{sentence}: </span>
                    <button type="button" onClick={() => setSelected(other)} className="text-left text-primary hover:underline">
                      {o.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            Click any dot to read it and see what it connects to. Drag to turn, scroll to zoom. The client sits at the
            centre, competitors around it, then subjects and events, AI insights, and the sources they rest on.
          </p>
        )}
      </aside>
    </div>
  );
}
