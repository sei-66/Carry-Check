import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ConvexPrism } from '../model/geometry-model';
import { entryStartCenterPosition } from '../model/entry-start';
import {
  createMaisonetteModel,
  type HousingElement,
  type HousingOpening,
} from '../model/maisonette-model';

type OwnResource = <T extends { dispose(): void }>(resource: T) => T;

/** Closed convex prism mesh derived from the same XZ vertices as collision. */
function prismGeometry(
  prism: ConvexPrism,
  visibleTopM: number,
): BufferGeometry {
  const count = prism.footprint.length;
  const vertices = [prism.bottomM, visibleTopM].flatMap((y) =>
    prism.footprint.flatMap((p) => [p.x, y, p.z]),
  );
  const indices: number[] = [];
  for (let i = 1; i < count - 1; i++)
    indices.push(0, i, i + 1, count, count + i + 1, count + i);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, count + i, count + next, i, count + next, next);
  }
  const area = prism.footprint.reduce((sum, p, i) => {
    const q = prism.footprint[(i + 1) % count];
    return sum + (q ? p.x * q.z - q.x * p.z : 0);
  }, 0);
  if (area < 0)
    for (let i = 0; i < indices.length; i += 3) {
      const first = indices[i],
        last = indices[i + 2];
      if (first !== undefined && last !== undefined) {
        indices[i] = last;
        indices[i + 2] = first;
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function cutawayTop(solid: ConvexPrism, kind: HousingElement['kind']): number {
  if (kind === 'wall') return Math.min(solid.topM, solid.bottomM + 0.42);
  if (kind === 'frame' && solid.topM > 10) {
    if (solid.id.includes('entry-jamb')) return 2.208;
    if (solid.id.includes('ldk-jamb')) return 5.205;
    return solid.bottomM + 0.15;
  }
  return solid.topM;
}

function addLabel(
  group: Group,
  own: OwnResource,
  text: string,
  x: number,
  y: number,
  z: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#fafbfc';
  context.strokeStyle = '#919ca8';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(3, 3, 378, 106, 18);
  context.fill();
  context.stroke();
  context.fillStyle = '#263443';
  context.font = '600 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 192, 58);
  const texture = own(new CanvasTexture(canvas));
  const material = own(
    new SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  const label = new Sprite(material);
  label.position.set(x, y, z);
  label.scale.set(0.9, 0.263, 1);
  label.renderOrder = 10;
  group.add(label);
}

function addOpeningLabel(
  group: Group,
  own: OwnResource,
  text: string,
  opening: HousingOpening,
  normalOffsetM: number,
  heightOffsetM: number,
) {
  const plane = opening.departurePlaneM + normalOffsetM;
  const transverse = (opening.transverseMinM + opening.transverseMaxM) / 2;
  addLabel(
    group,
    own,
    text,
    opening.widthAxis === 'x' ? transverse : plane / opening.normal.x,
    opening.floorHeightM + heightOffsetM,
    opening.widthAxis === 'z' ? transverse : plane / opening.normal.z,
  );
}

export function createHousingScene(own: OwnResource) {
  const model = createMaisonetteModel();
  const group = new Group();
  const floor = own(
    new MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
  );
  const waist = own(
    new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
  );
  const cap = own(
    new MeshStandardMaterial({ roughness: 0.62, flatShading: true }),
  );
  const wall = own(
    new MeshStandardMaterial({
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      roughness: 1,
    }),
  );
  const door = own(
    new MeshStandardMaterial({
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      roughness: 0.7,
    }),
  );
  const edge = own(new LineBasicMaterial({ transparent: true, opacity: 0.5 }));
  const materials = { floor, wall, waist, cap, frame: wall, door };
  const metadata = new Map(
    model.elements.map((element) => [element.id, element]),
  );
  // Only opaque, static surfaces share a draw call. Transparent walls, doors
  // and outlines retain their individual bounds and renderer sorting.
  const opaque = new Map<
    MeshStandardMaterial,
    { geometries: BufferGeometry[]; ids: string[] }
  >();
  for (const solid of model.geometry.physicalSolids) {
    const kind = metadata.get(solid.id)?.kind ?? 'wall';
    const geometry = prismGeometry(solid, cutawayTop(solid, kind));
    const material = materials[kind];
    if (material.transparent) {
      const mesh = new Mesh(own(geometry), material);
      mesh.name = solid.id;
      group.add(mesh);
    } else {
      const batch = opaque.get(material) ?? { geometries: [], ids: [] };
      batch.geometries.push(geometry);
      batch.ids.push(solid.id);
      opaque.set(material, batch);
    }
    group.add(new LineSegments(own(new EdgesGeometry(geometry)), edge));
  }
  for (const [material, { geometries, ids }] of opaque) {
    const geometry =
      geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries);
    if (!geometry) throw new Error('Opaque housing geometry merge failed');
    if (geometries.length > 1)
      for (const source of geometries) source.dispose();
    const mesh = new Mesh(own(geometry), material);
    mesh.name = 'opaque-housing';
    mesh.userData.solidIds = ids;
    group.add(mesh);
  }
  // Fit only the physical cutaway. Artificial outer limits and the virtual LDK
  // receiver have no visible room geometry and must not enlarge the framing.
  const visibleBounds = new Box3().setFromObject(group);
  const center = visibleBounds.getCenter(new Vector3());
  const radius = visibleBounds.getSize(new Vector3()).length() / 2;
  addOpeningLabel(group, own, '玄関', model.openings.entry, -1.53, 0.432);
  addOpeningLabel(group, own, 'LDK入口', model.openings.ldk, 0.5, 0.32);
  return {
    group,
    center: { x: center.x, y: center.y, z: center.z },
    radius,
    entryStart: entryStartCenterPosition(
      model.openings.entry,
      (model.openings.entry.transverseMinM +
        model.openings.entry.transverseMaxM) /
        2,
      model.openings.entry.floorHeightM,
    ),
    setAppearance(
      colors: { floor: string; wall: string; edge: string },
      dark: boolean,
      pop: boolean,
    ) {
      floor.color.set(colors.floor);
      wall.color.set(colors.wall);
      waist.color.set(dark ? '#717c8c' : '#d4d9df');
      cap.color.set(pop ? '#c89958' : dark ? '#b7bec8' : '#aab1ba');
      door.color.set(dark ? '#b8c2d0' : '#6a7888');
      edge.color.set(colors.edge);
    },
  };
}
