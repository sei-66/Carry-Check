import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  Line,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ValidatedDimensions } from '../domain/dimensions';
import type { ColorTheme, DesignTheme } from '../shared/appearance';
import type { PathFoundResult } from '../shared/calculation-messages';
import { distance, interpolatePose, rotationAngle } from '../domain/pose';
import { createHousingScene } from './housing-scene';

export interface ViewerContent {
  readonly dimensions: ValidatedDimensions | null;
  readonly path?: PathFoundResult | null;
}
export interface PlaybackState {
  readonly playing: boolean;
  readonly progress: number;
}
export type ViewPreset = 'perspective' | 'front' | 'top';

// Optional verification-only observations; no sampling work in normal use.
export interface ViewerFrameMetrics {
  readonly timeMs: number;
  readonly renderCpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
}

// The optional development environment stays display-only. Normal use renders
// the same assumed housing solids used by the Worker, with labelled cutaways.
export interface ViewerEnvironment {
  readonly center: Readonly<{ x: number; y: number; z: number }>;
  readonly radius: number;
  readonly description: string;
  readonly cuboids: readonly {
    readonly position: Readonly<{ x: number; y: number; z: number }>;
    readonly dimensions: Readonly<{ x: number; y: number; z: number }>;
    readonly surface: 'floor' | 'wall';
  }[];
}

const zoomInFactor = 0.82;

const palettes = {
  pop: {
    light: {
      background: '#e9edff',
      floor: '#d5ddff',
      wall: '#8b9cdd',
      edge: '#233e97',
      box: '#ff8a3d',
      tape: '#fff3d6',
      boxEdge: '#743718',
    },
    dark: {
      background: '#171c31',
      floor: '#242c48',
      wall: '#7f8bc0',
      edge: '#afc4fa',
      box: '#ff9a52',
      tape: '#fff0cf',
      boxEdge: '#713718',
    },
  },
  dot: {
    light: {
      background: '#f1f2f3',
      floor: '#dee1e4',
      wall: '#a1aab6',
      edge: '#525e6c',
      box: '#b2b8c0',
      tape: '#ff792e',
      boxEdge: '#49515c',
    },
    dark: {
      background: '#20242a',
      floor: '#2c323b',
      wall: '#8793a3',
      edge: '#bac3cf',
      box: '#b0b8c2',
      tape: '#ff873f',
      boxEdge: '#3d4550',
    },
  },
} as const;

export function createRouteViewer(
  container: HTMLElement,
  onContextLost: () => void,
  environment?: ViewerEnvironment,
  onPlayback?: (state: PlaybackState) => void,
  onFrame?: (metrics: ViewerFrameMetrics) => void,
) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let contextLost = false;
  let pendingFrame = 0;
  function own<T extends { dispose(): void }>(resource: T): T {
    cleanups.push(() => resource.dispose());
    return resource;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(pendingFrame);
    for (const cleanup of cleanups.reverse()) cleanup();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      environment?.description ??
        '仮定住宅の玄関、回り段と中央腰壁、2階廊下、LDK入口。壁は一部を切り欠いて表示しています。',
    );
    container.append(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(39, 1, 0.001, 200);
    const controls = own(new OrbitControls(camera, renderer.domElement));
    renderer.domElement.style.touchAction = 'none';
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    const lights = new Group();
    const key = new DirectionalLight('#ffffff', 3);
    key.position.set(-3, 8, -5);
    const fill = new DirectionalLight('#faf4e7', 1.1);
    fill.position.set(5, 4, 2);
    lights.add(key, fill, new HemisphereLight('#ffffff', '#647364', 2.2));
    scene.add(lights);

    const unitBox = own(new BoxGeometry(1, 1, 1));
    const unitEdges = own(new EdgesGeometry(unitBox));
    const boxMaterial = own(new MeshStandardMaterial({ roughness: 0.85 }));
    const tapeMaterial = own(new MeshStandardMaterial({ roughness: 0.9 }));
    const boxEdgesMaterial = own(
      new LineBasicMaterial({
        transparent: true,
        opacity: 0.65,
      }),
    );
    const box = new Group();
    box.add(
      new Mesh(unitBox, boxMaterial),
      new LineSegments(unitEdges, boxEdgesMaterial),
    );
    const tapeGeometry = own(new BoxGeometry(0.14, 1.005, 1.005));
    box.add(new Mesh(tapeGeometry, tapeMaterial));
    const item = new Group();
    item.visible = false;
    item.add(box);
    scene.add(item);
    const routeMaterial = own(
      new LineBasicMaterial({
        color: '#315cc7',
        transparent: true,
        opacity: 0.95,
      }),
    );
    const routeGeometry = own(new BufferGeometry());
    const route = new Line(routeGeometry, routeMaterial);
    route.visible = false;
    scene.add(route);
    const housing = environment ? null : createHousingScene(own);
    if (housing) scene.add(housing.group);

    const floorMaterial = own(new MeshStandardMaterial({ roughness: 1 }));
    const wallMaterial = own(
      new MeshStandardMaterial({
        roughness: 1,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
    );
    const environmentEdgeMaterial = own(
      new LineBasicMaterial({
        transparent: true,
        opacity: 0.63,
      }),
    );
    for (const surface of environment?.cuboids ?? []) {
      const group = new Group();
      group.add(
        new Mesh(
          unitBox,
          surface.surface === 'floor' ? floorMaterial : wallMaterial,
        ),
        new LineSegments(unitEdges, environmentEdgeMaterial),
      );
      group.scale.set(
        surface.dimensions.x,
        surface.dimensions.y,
        surface.dimensions.z,
      );
      group.position.set(
        surface.position.x,
        surface.position.y,
        surface.position.z,
      );
      scene.add(group);
    }
    const center = environment?.center ??
      housing?.center ?? { x: 0, y: 0, z: 0 };
    controls.target.set(center.x, center.y, center.z);
    let content: ViewerContent | undefined;
    let radius = environment?.radius ?? housing?.radius ?? 0.8;
    let framingDistance = 0;
    let visible = true;
    let playing = false;
    let progress = 0;
    let previousFrameTime = 0;
    let lastNotification = 0;
    let weights: readonly number[] = [];
    let totalWeight = 0;
    const motionPreference = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );
    const notifyPlayback = () => onPlayback?.({ playing, progress });
    function applyPose() {
      const poses = content?.path?.poses;
      if (!poses?.length) return;
      const target = progress * totalWeight;
      let index = 0;
      while (
        index < weights.length - 1 &&
        (weights[index + 1] ?? Infinity) < target
      )
        index++;
      const start = poses[index],
        end = poses[Math.min(index + 1, poses.length - 1)];
      if (!start || !end) return;
      const from = weights[index] ?? 0,
        to = weights[index + 1] ?? totalWeight;
      const fraction =
        to > from ? Math.max(0, Math.min(1, (target - from) / (to - from))) : 0;
      const pose = interpolatePose(start, end, fraction);
      item.position.set(pose.position.x, pose.position.y, pose.position.z);
      item.quaternion.set(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      );
    }
    function setPlaying(next: boolean) {
      playing =
        next &&
        !!content?.path &&
        !motionPreference.matches &&
        visible &&
        !document.hidden;
      if (playing && progress >= 1) progress = 0;
      previousFrameTime = 0;
      applyPose();
      notifyPlayback();
      render();
    }
    function render() {
      if (
        disposed ||
        contextLost ||
        !visible ||
        document.hidden ||
        pendingFrame
      )
        return;
      pendingFrame = requestAnimationFrame((time) => {
        pendingFrame = 0;
        if (!disposed && !contextLost && visible && !document.hidden) {
          if (playing) {
            const elapsed = previousFrameTime
              ? Math.min(time - previousFrameTime, 100)
              : 0;
            const durationMs = Math.max(
              10000,
              Math.min(45000, totalWeight * 1500),
            );
            progress = Math.min(1, progress + elapsed / durationMs);
            previousFrameTime = time;
            applyPose();
            if (progress >= 1) playing = false;
            if (time - lastNotification >= 100 || !playing) {
              lastNotification = time;
              notifyPlayback();
            }
          }
          const renderBegan = onFrame ? performance.now() : 0;
          renderer.render(scene, camera);
          onFrame?.({
            timeMs: time,
            renderCpuMs: performance.now() - renderBegan,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
          });
          if (playing) render();
        }
      });
    }

    function fitDistance() {
      const verticalHalfFov = (camera.fov * Math.PI) / 360;
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * camera.aspect,
      );
      const distance =
        (radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov))) * 1.2;
      controls.minDistance = Math.max(radius * (housing ? 0.25 : 1.1), 0.003);
      controls.maxDistance = distance * 4;
      // Default framing matches one press of the zoom-in button.
      return distance * zoomInFactor;
    }
    function fitView(keepZoom = false) {
      const offset = camera.position.clone().sub(controls.target);
      const zoomFactor =
        keepZoom && framingDistance > 0 ? offset.length() / framingDistance : 1;
      if (offset.lengthSq() === 0) offset.set(7.3, 4.3, -8.8);
      framingDistance = fitDistance();
      camera.position
        .copy(controls.target)
        .add(offset.setLength(framingDistance * zoomFactor));
      camera.near = Math.max(radius / 100, 0.0001);
      camera.far = Math.max(controls.maxDistance * 2, 20);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    }
    function setContent(next: ViewerContent) {
      const dimensionsChanged = content?.dimensions !== next.dimensions;
      const pathChanged = content?.path !== next.path;
      const previousRadius = radius;
      content = next;
      item.visible = next.dimensions !== null;
      if (next.dimensions) {
        const { packed, clearance } = next.dimensions;
        box.scale.set(packed.x, packed.y, packed.z);
        if (!environment)
          radius = Math.max(
            housing?.radius ?? 0.8,
            Math.hypot(clearance.x, clearance.y, clearance.z) / 2,
          );
        if (!next.path) {
          const start = housing?.entryStart ?? { x: 0, y: 0, z: -0.99 };
          item.position.set(start.x, start.y + clearance.y / 2 + 0.08, start.z);
          item.quaternion.set(0, 0, 0, 1);
          if (housing) {
            radius = Math.max(
              radius,
              distance(item.position, center) +
                Math.hypot(clearance.x, clearance.y, clearance.z) / 2,
            );
          }
        }
      }
      if (pathChanged) {
        playing = false;
        progress = 0;
        previousFrameTime = 0;
        totalWeight = 0;
        const nextWeights: number[] = [];
        const poses = next.path?.poses ?? [];
        for (const [index, pose] of poses.entries()) {
          const previous = poses[index - 1];
          if (previous)
            totalWeight +=
              distance(previous.position, pose.position) +
              rotationAngle(previous.rotation, pose.rotation) *
                Math.max(
                  0.2,
                  Math.hypot(
                    next.dimensions?.packed.x ?? 0,
                    next.dimensions?.packed.y ?? 0,
                    next.dimensions?.packed.z ?? 0,
                  ) / 2,
                );
          nextWeights.push(totalWeight);
        }
        weights = nextWeights;
        routeGeometry.dispose();
        routeGeometry.deleteAttribute('position');
        routeGeometry.boundingSphere = null;
        routeGeometry.setFromPoints(
          poses.map(
            (pose) =>
              new Vector3(pose.position.x, pose.position.y, pose.position.z),
          ),
        );
        routeGeometry.setDrawRange(0, poses.length);
        if (poses.length > 0) routeGeometry.computeBoundingSphere();
        if (!environment && next.dimensions) {
          const clearanceRadius =
            Math.hypot(
              next.dimensions.clearance.x,
              next.dimensions.clearance.y,
              next.dimensions.clearance.z,
            ) / 2;
          radius = Math.max(
            radius,
            ...poses.map(
              (pose) => distance(pose.position, center) + clearanceRadius,
            ),
          );
        }
        route.visible = poses.length > 1;
        notifyPlayback();
        applyPose();
      }
      if (dimensionsChanged) fitView();
      else if (radius !== previousRadius) fitView(true);
      else render();
    }
    function setView(preset: ViewPreset) {
      const direction =
        preset === 'front'
          ? new Vector3(0, 0, -1)
          : preset === 'top'
            ? new Vector3(0, 1, -0.001)
            : new Vector3(7.3, 4.3, -8.8);
      camera.position
        .copy(controls.target)
        .add(direction.setLength(fitDistance()));
      framingDistance = fitDistance();
      controls.update();
      render();
    }
    function setAppearance(theme: ColorTheme, design: DesignTheme) {
      const colors = palettes[design][theme];
      scene.background = new Color(colors.background);
      boxMaterial.color.set(colors.box);
      tapeMaterial.color.set(colors.tape);
      boxEdgesMaterial.color.set(colors.boxEdge);
      floorMaterial.color.set(colors.floor);
      wallMaterial.color.set(colors.wall);
      environmentEdgeMaterial.color.set(colors.edge);
      routeMaterial.color.set(
        theme === 'dark' ? '#a0baff' : design === 'pop' ? '#2546d9' : '#315cc7',
      );
      housing?.setAppearance(colors, theme === 'dark', design === 'pop');
      render();
    }
    function resize() {
      const { clientWidth: width, clientHeight: height } = container;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      fitView(true);
    }
    const observer = new ResizeObserver(resize);
    cleanups.push(() => observer.disconnect());
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (!visible && playing) setPlaying(false);
      render();
    });
    cleanups.push(() => intersection.disconnect());
    const onVisibility = () => {
      if (document.hidden && playing) setPlaying(false);
      render();
    };
    const onMotionChange = () => {
      if (motionPreference.matches && playing) setPlaying(false);
    };
    motionPreference.addEventListener('change', onMotionChange);
    cleanups.push(() =>
      motionPreference.removeEventListener('change', onMotionChange),
    );
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      playing = false;
      notifyPlayback();
      controls.enabled = false;
      onContextLost();
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    cleanups.push(() =>
      renderer.domElement.removeEventListener('webglcontextlost', onLost),
    );
    document.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() =>
      document.removeEventListener('visibilitychange', onVisibility),
    );
    controls.addEventListener('change', render);
    cleanups.push(() => controls.removeEventListener('change', render));
    observer.observe(container);
    intersection.observe(container);
    setAppearance('light', 'dot');
    setView('perspective');
    resize();

    return {
      setContent,
      setView,
      setAppearance,
      setPlaying,
      setPlaybackPosition(value: number) {
        if (!Number.isFinite(value)) return;
        playing = false;
        progress = Math.max(0, Math.min(1, value));
        applyPose();
        notifyPlayback();
        render();
      },
      zoom(this: void, direction: 'in' | 'out') {
        const offset = camera.position.clone().sub(controls.target);
        const distance = Math.min(
          controls.maxDistance,
          Math.max(
            controls.minDistance,
            offset.length() * (direction === 'in' ? zoomInFactor : 1.22),
          ),
        );
        camera.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
        render();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
