// The hero art: a slow stream of dark glass slips, each one a real payout,
// flowing through a glass arch shaped like the curve of the n in our mark.
// The arch is the objection window: slips that pass through it pick up a
// thin tidal-cyan edge (paid). That edge is the only colour in the scene.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const COUNT = 13;
const ARCH_AT = 0.5; // where along the stream the window sits
const W = 1.5, H = 0.92, D = 0.05;

function labelTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 314;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "500 30px 'Geist Mono', ui-monospace, monospace";
  const [a, b] = text.split("\n");
  g.fillText(a ?? "", 36, 230);
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.font = "400 24px 'Geist Mono', ui-monospace, monospace";
  g.fillText(b ?? "", 36, 272);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(36, 44, 54, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function GlassLedger({ labels, className }: { labels: string[]; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const key = labels.join("|");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 12);

    // The stream: from far behind, through the window, out towards the viewer.
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(3.2, 3.6, -16),
      new THREE.Vector3(1.6, 1.4, -7),
      new THREE.Vector3(0.3, 0.0, -1.5),
      new THREE.Vector3(-1.0, -1.7, 3.0),
      new THREE.Vector3(-2.2, -4.2, 6.5),
    ]);

    // The window: half a glass ring, the n's arch, standing across the stream.
    const chrome = new THREE.MeshPhysicalMaterial({ color: 0x8c949e, metalness: 1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.075, 32, 120, Math.PI), chrome);
    // Faces the viewer, so the slips are seen passing through its opening.
    arch.position.copy(path.getPointAt(ARCH_AT));
    arch.position.y -= 0.05;
    arch.rotation.set(0, -0.28, 0);
    scene.add(arch);
    const legGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.1, 24);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, chrome);
      leg.position.set(side * 1.25, -0.55, 0);
      arch.add(leg);
    }

    const glass = new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0.2, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.7 });
    const slipGeo = new RoundedBoxGeometry(W, H, D, 4, 0.07);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W - 0.02, H - 0.02, D + 0.004));
    const white = new THREE.Color(0xffffff);
    const tidal = new THREE.Color(0x13b5cb);
    const textures: THREE.Texture[] = [];

    const slips = Array.from({ length: COUNT }, (_, i) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(slipGeo, glass));
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
      g.add(new THREE.LineSegments(edgeGeo, edgeMat));
      const tex = labelTexture(labels[i % Math.max(1, labels.length)] ?? "");
      textures.push(tex);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, H * 0.94), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false }));
      face.position.z = D / 2 + 0.003;
      g.add(face);
      scene.add(g);
      return { g, edgeMat, offset: i / COUNT };
    });

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(-3, 5, 6);
    scene.add(keyLight);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = w / h < 0.9 ? 12 / Math.max(0.5, w / h) * 0.9 : 12;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(el);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", onMove, { passive: true });

    const start = performance.now();
    let raf = 0;
    const place = (time: number) => {
      for (const s of slips) {
        // Wrap into [0, 1): the first frame's timestamp can precede `start`, making time negative.
        const t = (((s.offset + time * 0.018) % 1) + 1) % 1;
        const p = path.getPointAt(t);
        s.g.position.copy(p);
        // A slow tumble along the stream, facing mostly towards the viewer.
        s.g.rotation.set(-0.12 + t * 0.25, -0.35 + t * 0.55, 0.12 - t * 0.3);
        // Past the window: paid, a thin tidal edge. Fade in and out at the ends.
        const paid = THREE.MathUtils.smoothstep(t, ARCH_AT - 0.02, ARCH_AT + 0.04);
        s.edgeMat.color.copy(white).lerp(tidal, paid);
        const ends = Math.min(THREE.MathUtils.smoothstep(t, 0, 0.12), 1 - THREE.MathUtils.smoothstep(t, 0.88, 1));
        s.edgeMat.opacity = (0.18 + paid * 0.72) * ends;
        s.g.scale.setScalar(0.5 + 0.5 * ends);
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const time = still ? 12 : Math.max(0, (now - start) / 1000);
      place(time);
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      scene.rotation.y = pointer.x * 0.12;
      scene.rotation.x = pointer.y * 0.06;
      renderer.render(scene, camera);
      if (still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      textures.forEach((t) => t.dispose());
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={host} className={className} aria-hidden />;
}
