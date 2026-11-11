// The Nutus mark as a glossy 3D object: the same two strokes as the logo
// (u, then n), swept into tubes and finished in dark chrome on black.
// On load the strokes start apart and glide together: two separate marks
// agreeing, the nod. Scrolling drifts them apart again; the pointer tilts it.
// One small tidal-cyan light is the only colour.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const S = 1 / 40; // logo units → scene units
const toV = (x: number, y: number) => new THREE.Vector3((x - 92) * S, (48 - y) * S, 0);

function arc(cx: number, cy: number, r: number, from: number, to: number, n = 48) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    pts.push(toV(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}
const line = (x1: number, y1: number, x2: number, y2: number, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => toV(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n));

/** Points along each stroke, matching the SVG mark exactly. */
const deg = Math.PI / 180;
const U = [...line(14, 12, 14, 60), ...arc(38, 60, 24, 180 * deg, 36.87 * deg).slice(1), ...line(57.2, 74.4, 104, 12).slice(1)];
const N = [...line(80, 84, 126.8, 21.6), ...arc(146, 36, 24, 216.87 * deg, 360 * deg).slice(1), ...line(170, 36, 170, 84).slice(1)];

function stroke(points: THREE.Vector3[], mat: THREE.Material) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const r = 6 * S;
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 320, r, 40, false), mat));
  for (const p of [points[0]!, points[points.length - 1]!]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20), mat);
    cap.position.copy(p);
    g.add(cap);
  }
  return g;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

export function GlassMark({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 9);

    const chrome = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.25 });
    const mark = new THREE.Group();
    const u = stroke(U, chrome);
    const n = stroke(N, chrome);
    mark.add(u, n);
    mark.scale.setScalar(1.05);
    // Sit above the headline, which lives in the bottom third of the hero.
    const lift = new THREE.Group();
    lift.position.y = 0.55;
    lift.add(mark);
    scene.add(lift);

    // The only colour: a small tidal-cyan light catching the edges.
    const tidal = new THREE.PointLight(0x13b5cb, 22, 12, 2);
    tidal.position.set(-2.6, -1.4, 2.4);
    scene.add(tidal);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 4, 5);
    scene.add(key);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Keep the whole mark in frame on narrow screens.
      camera.position.z = w / h < 1 ? 10.5 / Math.max(0.4, w / h) : 9;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(el);

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = (now - start) / 1000;
      // Assemble: strokes start apart and turned, then meet.
      const a = still ? 1 : ease((t - 0.2) / 1.8);
      // Scroll drift: as the hero leaves, they part again a little.
      const sc = Math.min(1, Math.max(0, scrollY / Math.max(1, el.clientHeight)));
      const apart = (1 - a) * 2.4 + sc * 0.9;
      u.position.set(-apart, (1 - a) * 0.6, (1 - a) * -1.2);
      n.position.set(apart, -(1 - a) * 0.6, (1 - a) * -1.2);
      u.rotation.z = (1 - a) * 0.5 + sc * 0.12;
      n.rotation.z = -(1 - a) * 0.5 - sc * 0.12;

      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      const idle = still ? 0 : Math.sin(t * 0.45) * 0.22;
      mark.rotation.y = idle + pointer.x * 0.35;
      mark.rotation.x = -0.12 + pointer.y * 0.2 + (still ? 0 : Math.sin(t * 0.3) * 0.05);
      tidal.position.x = -2.6 + Math.sin(t * 0.5) * 1.2;
      renderer.render(scene, camera);
      if (still && a === 1) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      chrome.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={className} role="img" aria-label="The Nutus mark: a u and an n" />;
}
