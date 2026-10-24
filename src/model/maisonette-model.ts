import type { Vector3 } from '../domain/pose';
import type { Bounds } from '../geometry/scene';
import {
  validateGeometryModel,
  type ConvexPrism,
  type FloorPortal,
  type FloorRegion,
  type GeometryModel,
  type PointXZ,
} from './geometry-model';
import {
  MAISONETTE_ASSUMPTIONS,
  MAISONETTE_ASSUMPTION_SET,
  MAISONETTE_MODEL_VERSION,
  type HousingAssumption,
} from './maisonette-assumptions';

export { MAISONETTE_MODEL_VERSION } from './maisonette-assumptions';

export type RouteStage = 'entry' | 'stairs' | 'upper-hall' | 'ldk';

export interface HousingOpening {
  readonly id: string;
  readonly normal: Vector3;
  /** Planes are dot(normal, position); approach < departure in travel direction. */
  readonly approachPlaneM: number;
  readonly departurePlaneM: number;
  readonly floorHeightM: number;
  readonly clearWidthM: number;
  readonly clearHeightM: number;
  readonly widthAxis: 'x' | 'z';
  readonly transverseMinM: number;
  readonly transverseMaxM: number;
  readonly fixedDoorSolidId: string;
  readonly epsilonM: number;
}

export interface RouteGuidePoint {
  readonly floorRegionId: string;
  readonly positionXZ: PointXZ;
  readonly floorHeightM: number;
  readonly stage: RouteStage;
}

export interface HousingStep {
  readonly id: string;
  readonly number: number;
  readonly kind: 'lower-straight' | 'winder' | 'upper-straight';
  readonly floorRegionId: string;
  readonly physicalSolidId: string;
  readonly footprint: readonly PointXZ[];
  readonly floorHeightM: number;
  readonly bottomM: number;
  readonly riseM: number;
  readonly precedingPortalId: string;
  readonly followingPortalId: string;
  readonly dimensionIds: readonly string[];
  readonly assumptionIds: readonly string[];
}

export interface HousingElement {
  readonly id: string;
  readonly label: string;
  readonly kind: 'floor' | 'wall' | 'waist' | 'cap' | 'frame' | 'door';
  readonly assumptionIds: readonly string[];
}

export interface MaisonetteModel {
  readonly geometry: GeometryModel;
  readonly metadata: {
    readonly modelVersion: typeof MAISONETTE_MODEL_VERSION;
    readonly assumptionSetId: typeof MAISONETTE_ASSUMPTION_SET;
    readonly measurementCount: 0;
    readonly uncertainty: 'unknown';
    readonly sourceRegistrationId: string;
  };
  readonly openings: {
    readonly entry: HousingOpening;
    readonly ldk: HousingOpening;
  };
  /** Search hints only. These points are not a prescribed or verified trajectory. */
  readonly guide: readonly RouteGuidePoint[];
  readonly startRegionIds: readonly string[];
  readonly goalRegionId: string;
  /** Convex rectangular exterior area containing the full clearance footprint. */
  readonly startBounds: Bounds;
  readonly terminalReference: {
    readonly regionId: string;
    readonly normalDepthM: number;
    readonly straightOnly: true;
    readonly physicalInteriorEvaluated: false;
  };
  readonly assumptions: readonly HousingAssumption[];
  readonly stepLedger: readonly HousingStep[];
  readonly elements: readonly HousingElement[];
  readonly sourceRegistration: {
    readonly id: string;
    readonly certainty: 'assumed';
    readonly description: string;
  };
  readonly unconfirmedItems: readonly string[];
}

const MAX_LIFT_M = 0.72;
const PHYSICAL_BOTTOM_M = -0.22;
const WALL_TOP_M = 14.25;
const UPPER_FLOOR_M = 3.05;
// The assumed slab underside meets the last straight tread (2.880 m),
// closing the final riser without a hidden 10 mm gap in the physical model.
const UPPER_BOTTOM_M = 2.88;
const TERMINAL_EPSILON_M = 0.0015;
// The layout is designed around the staircase centre. Register the entry centre
// to world X=0 explicitly, rather than hiding a photo mirroring in the renderer.
const ENTRY_LAYOUT_X_M = 0.44;
const worldX = (layoutX: number) =>
  Number((layoutX - ENTRY_LAYOUT_X_M).toFixed(6));
const point = (x: number, z: number): PointXZ => ({ x: worldX(x), z });
const level = (riseNumber: number) =>
  Number((0.16 + riseNumber * 0.17).toFixed(6));
const stepZ = (index: number) => Number((1.52 + index * 0.23).toFixed(6));

function rectangle(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): readonly PointXZ[] {
  return [point(x0, z0), point(x1, z0), point(x1, z1), point(x0, z1)];
}

function sharedEdge(
  a: FloorRegion,
  b: FloorRegion,
): readonly [PointXZ, PointXZ] {
  const equal = (p: PointXZ, q: PointXZ) => p.x === q.x && p.z === q.z;
  for (const [index, start] of a.footprint.entries()) {
    const end = a.footprint[(index + 1) % a.footprint.length];
    if (!end) continue;
    if (
      b.footprint.some((p, i) => {
        const q = b.footprint[(i + 1) % b.footprint.length];
        return (
          !!q &&
          ((equal(start, p) && equal(end, q)) ||
            (equal(start, q) && equal(end, p)))
        );
      })
    )
      return [start, end];
  }
  throw new Error(
    `Housing floors have no complete shared edge: ${a.id} / ${b.id}`,
  );
}

/** No image assets or fixture values are imported by this housing model. */
export function createMaisonetteModel(): MaisonetteModel {
  const physicalSolids: ConvexPrism[] = [];
  const floorRegions: FloorRegion[] = [];
  const portals: FloorPortal[] = [];
  const guide: RouteGuidePoint[] = [];
  const elements: HousingElement[] = [];
  const stepDrafts: Omit<
    HousingStep,
    'precedingPortalId' | 'followingPortalId'
  >[] = [];

  const solid = (
    id: string,
    footprint: readonly PointXZ[],
    bottomM: number,
    topM: number,
    kind: HousingElement['kind'],
    label: string,
    assumptionIds: readonly string[],
  ) => {
    physicalSolids.push({ id, footprint, bottomM, topM });
    elements.push({ id, kind, label, assumptionIds });
  };
  const box = (
    id: string,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    bottomM: number,
    topM: number,
    kind: HousingElement['kind'],
    label: string,
    assumptionIds: readonly string[],
  ) =>
    solid(
      id,
      rectangle(x0, x1, z0, z1),
      bottomM,
      topM,
      kind,
      label,
      assumptionIds,
    );
  const floor = (
    label: string,
    footprint: readonly PointXZ[],
    floorHeightM: number,
    bottomM: number,
    assumptionIds: readonly string[],
  ) => {
    const id = `region-${label}`;
    const physicalSolidId = `solid-floor-${label}`;
    solid(
      physicalSolidId,
      footprint,
      bottomM,
      floorHeightM,
      'floor',
      label,
      assumptionIds,
    );
    const region: FloorRegion = {
      id,
      footprint,
      floorHeightM,
      maxLiftM: MAX_LIFT_M,
      physicalSolidId,
    };
    floorRegions.push(region);
    return region;
  };
  const connect = (a: FloorRegion, b: FloorRegion) => {
    const existing = portals.find(
      (p) => p.fromRegionId === a.id && p.toRegionId === b.id,
    );
    if (existing) return existing.id;
    const id = `portal-${a.id.slice(7)}--${b.id.slice(7)}`;
    portals.push({
      id,
      fromRegionId: a.id,
      toRegionId: b.id,
      edge: sharedEdge(a, b),
    });
    return id;
  };
  const guidePoint = (region: FloorRegion, stage: RouteStage, at?: PointXZ) => {
    guide.push({
      floorRegionId: region.id,
      positionXZ: at ?? {
        x:
          region.footprint.reduce((sum, p) => sum + p.x, 0) /
          region.footprint.length,
        z:
          region.footprint.reduce((sum, p) => sum + p.z, 0) /
          region.footprint.length,
      },
      floorHeightM: region.floorHeightM,
      stage,
    });
  };

  const outsideLeft = floor(
    'entry-outside-side',
    rectangle(-0.825, 0.055, -1.85, -0.145),
    0,
    PHYSICAL_BOTTOM_M,
    ['A-OUTSIDE'],
  );
  const outside = floor(
    'entry-outside',
    rectangle(0.055, 0.825, -1.85, -0.145),
    0,
    PHYSICAL_BOTTOM_M,
    ['A-OUTSIDE'],
  );
  const entryThreshold = floor(
    'entry-threshold',
    rectangle(0.055, 0.825, -0.145, 0),
    0.018,
    PHYSICAL_BOTTOM_M,
    ['A-ENTRY'],
  );
  const domaLeft = floor(
    'doma-side',
    rectangle(-0.825, 0.055, 0, 0.9),
    0,
    PHYSICAL_BOTTOM_M,
    ['A-ENTRY-FLOORS'],
  );
  const doma = floor(
    'doma',
    rectangle(0.055, 0.825, 0, 0.9),
    0,
    PHYSICAL_BOTTOM_M,
    ['A-ENTRY-FLOORS'],
  );
  const preStair = floor(
    'pre-stair',
    rectangle(0.055, 0.825, 0.9, 1.52),
    0.16,
    PHYSICAL_BOTTOM_M,
    ['A-ENTRY-FLOORS'],
  );
  connect(outsideLeft, outside);
  connect(outside, entryThreshold);
  connect(entryThreshold, doma);
  connect(domaLeft, doma);
  connect(doma, preStair);
  for (const region of [outside, entryThreshold, doma, preStair])
    guidePoint(region, 'entry');

  const stairs: FloorRegion[] = [];
  const addStep = (
    kind: HousingStep['kind'],
    footprint: readonly PointXZ[],
  ) => {
    const number = stairs.length + 1;
    const label = `step-${String(number).padStart(3, '0')}`;
    const assumptionIds = [
      'A-STAIR-PLAN',
      'A-STAIR-LEVELS',
      ...(kind === 'winder' ? ['A-WINDERS'] : []),
    ];
    const region = floor(
      label,
      footprint,
      level(number),
      PHYSICAL_BOTTOM_M,
      assumptionIds,
    );
    stairs.push(region);
    stepDrafts.push({
      id: label,
      number,
      kind,
      floorRegionId: region.id,
      physicalSolidId: `solid-floor-${label}`,
      footprint,
      floorHeightM: region.floorHeightM,
      bottomM: PHYSICAL_BOTTOM_M,
      riseM: 0.17,
      dimensionIds: [
        'D-STAIR-COUNT',
        'D-FLOOR-RISE',
        'D-RISER-i',
        kind === 'winder' ? 'D-WINDER-i' : 'D-TREAD-i',
      ],
      assumptionIds,
    });
    guidePoint(region, 'stairs');
  };
  for (let i = 0; i < 5; i++)
    addStep('lower-straight', rectangle(0.055, 0.825, stepZ(i), stepZ(i + 1)));
  const winderFootprints: readonly (readonly PointXZ[])[] = [
    [
      point(0.055, 2.67),
      point(0.825, 2.67),
      point(0.825, 3.058),
      point(0.055, 2.725),
    ],
    [
      point(0.055, 2.725),
      point(0.825, 3.058),
      point(0.825, 3.445),
      point(0.46, 3.445),
    ],
    [point(0.055, 2.725), point(0.46, 3.445), point(0, 3.445), point(0, 2.725)],
    [
      point(0, 2.725),
      point(0, 3.445),
      point(-0.46, 3.445),
      point(-0.055, 2.725),
    ],
    [
      point(-0.055, 2.725),
      point(-0.46, 3.445),
      point(-0.825, 3.445),
      point(-0.825, 3.058),
    ],
    [
      point(-0.055, 2.67),
      point(-0.055, 2.725),
      point(-0.825, 3.058),
      point(-0.825, 2.67),
    ],
  ];
  for (const footprint of winderFootprints) addStep('winder', footprint);
  for (let i = 4; i >= 0; i--)
    addStep(
      'upper-straight',
      rectangle(-0.825, -0.055, stepZ(i), stepZ(i + 1)),
    );

  // U3 corrects the turn after the upper flight: -Z travel turns right to +X.
  // Keep the arrival square, corridor width and total 2.310 m floor length.
  const upperFloor = (label: string, footprint: readonly PointXZ[]) =>
    floor(`upper-hall-${label}`, footprint, UPPER_FLOOR_M, UPPER_BOTTOM_M, [
      'A-UPPER-HALL',
    ]);
  const hallArrival = upperFloor(
    'arrival',
    rectangle(-0.825, -0.055, 0.75, 1.52),
  );
  const hallMiddle = upperFloor('middle', rectangle(-0.055, 0.715, 0.75, 1.52));
  // The centre trapezoid shares a complete edge with the narrower LDK opening.
  // The two side triangles complete the same rectangular floor without gaps.
  const hallApproach = upperFloor('approach', [
    point(0.715, 0.75),
    point(1.485, 0.775),
    point(1.485, 1.495),
    point(0.715, 1.52),
  ]);
  const hallLeft = upperFloor('left', [
    point(0.715, 0.75),
    point(1.485, 0.75),
    point(1.485, 0.775),
  ]);
  const hallRight = upperFloor('right', [
    point(0.715, 1.52),
    point(1.485, 1.495),
    point(1.485, 1.52),
  ]);
  connect(hallArrival, hallMiddle);
  connect(hallMiddle, hallApproach);
  connect(hallApproach, hallLeft);
  connect(hallApproach, hallRight);
  const orderedStairFloors = [preStair, ...stairs, hallArrival];
  for (let i = 1; i < orderedStairFloors.length; i++) {
    const a = orderedStairFloors[i - 1],
      b = orderedStairFloors[i];
    if (!a || !b) throw new Error('Missing staircase floor');
    connect(a, b);
  }
  for (const region of [hallArrival, hallMiddle, hallApproach])
    guidePoint(region, 'upper-hall');
  const ldkThreshold = floor(
    'ldk-threshold',
    rectangle(1.485, 1.605, 0.775, 1.495),
    UPPER_FLOOR_M,
    UPPER_BOTTOM_M,
    ['A-LDK'],
  );
  const receiver: FloorRegion = {
    id: 'region-ldk-receiver',
    footprint: rectangle(1.605, 10.615, 0.775, 1.495),
    floorHeightM: UPPER_FLOOR_M,
    maxLiftM: MAX_LIFT_M,
    physicalSolidId: null,
    basis: 'terminal-reference',
  };
  floorRegions.push(receiver);
  connect(hallApproach, ldkThreshold);
  connect(ldkThreshold, receiver);
  guidePoint(ldkThreshold, 'ldk');
  guidePoint(receiver, 'ldk', point(1.92, 1.135));

  // This lower-floor wall crosses the corrected upper corridor. Only its
  // artificial extension there stops at the slab; both flanks remain closed.
  box(
    'solid-wall-entry-side',
    0.825,
    0.945,
    1.52,
    3.565,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '階段外側壁',
    ['A-SOLIDS'],
  );
  box(
    'solid-wall-entry-side-front',
    0.825,
    0.945,
    0,
    0.75,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '土間の階段外側壁',
    ['A-SOLIDS'],
  );
  box(
    'solid-wall-entry-side-under-upper-hall',
    0.825,
    0.945,
    0.75,
    1.52,
    PHYSICAL_BOTTOM_M,
    UPPER_BOTTOM_M,
    'wall',
    '2階廊下直下の階段外側壁',
    ['A-SOLIDS', 'A-UPPER-HALL'],
  );
  box(
    'solid-wall-return-back',
    -0.945,
    0.945,
    3.445,
    3.565,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '折返し奥壁',
    ['A-SOLIDS'],
  );
  box(
    'solid-wall-return-side',
    -0.945,
    -0.825,
    1.52,
    3.445,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '上側階段外壁',
    ['A-SOLIDS'],
  );
  box(
    'solid-wall-doma-side',
    -0.945,
    -0.825,
    0,
    0.76,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '土間側壁',
    ['A-SOLIDS'],
  );
  box(
    'solid-wall-under-upper-hall',
    -0.945,
    -0.825,
    0.76,
    1.52,
    PHYSICAL_BOTTOM_M,
    UPPER_FLOOR_M,
    'wall',
    '2階廊下下部の壁',
    ['A-SOLIDS', 'A-UPPER-HALL'],
  );
  box(
    'solid-entry-jamb-left',
    -0.945,
    0.055,
    -0.145,
    0,
    PHYSICAL_BOTTOM_M,
    // The +X upper hall no longer overlaps this frame. Restore the artificial
    // wall extension so a tilted item's upper end cannot use the old notch.
    WALL_TOP_M,
    'frame',
    '玄関左枠と壁',
    ['A-ENTRY', 'A-SOLIDS'],
  );
  box(
    'solid-entry-jamb-right',
    0.825,
    0.945,
    -0.145,
    0,
    PHYSICAL_BOTTOM_M,
    WALL_TOP_M,
    'frame',
    '玄関右枠と壁',
    ['A-ENTRY'],
  );
  box(
    'solid-entry-header',
    0.055,
    0.825,
    -0.145,
    0,
    2.058,
    WALL_TOP_M,
    'frame',
    '玄関上枠',
    ['A-ENTRY'],
  );
  box(
    'solid-entry-leaf-open',
    0.825,
    0.863,
    -0.945,
    -0.145,
    0.018,
    2.058,
    'door',
    '玄関扉・外側90度固定',
    ['A-ENTRY'],
  );

  for (let i = 0; i < 5; i++) {
    const top = Number((level(16 - i) + 0.83).toFixed(6));
    box(
      `solid-waist-${i}`,
      -0.055,
      0.055,
      stepZ(i),
      stepZ(i + 1),
      PHYSICAL_BOTTOM_M,
      top,
      'waist',
      '中央腰壁',
      ['A-WAIST'],
    );
    box(
      `solid-waist-cap-${i}`,
      -0.075,
      0.075,
      stepZ(i),
      stepZ(i + 1),
      top,
      Number((top + 0.032).toFixed(6)),
      'cap',
      '中央腰壁の笠木',
      ['A-WAIST'],
    );
  }
  box(
    'solid-waist-tip',
    -0.055,
    0.055,
    2.67,
    2.725,
    PHYSICAL_BOTTOM_M,
    3.03,
    'waist',
    '中央腰壁の閉じた端部',
    ['A-WAIST'],
  );
  box(
    'solid-waist-cap-tip',
    -0.075,
    0.075,
    2.67,
    2.745,
    3.03,
    3.062,
    'cap',
    '中央腰壁の笠木端部',
    ['A-WAIST'],
  );

  // A closed leaf seals each other-room opening. Its wall is absent only inside
  // that leaf's aperture; no adjacent-room floor or alternative route is added.
  const closedWall = (
    id: string,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    floorY: number,
    topY: number,
    doorX0: number,
    doorX1: number,
    label: string,
  ) => {
    box(
      `solid-${id}-left`,
      x0,
      doorX0,
      z0,
      z1,
      floorY,
      topY,
      'wall',
      `${label}左壁`,
      ['A-CLOSED-DOORS'],
    );
    box(
      `solid-${id}-right`,
      doorX1,
      x1,
      z0,
      z1,
      floorY,
      topY,
      'wall',
      `${label}右壁`,
      ['A-CLOSED-DOORS'],
    );
    box(
      `solid-${id}-header`,
      doorX0,
      doorX1,
      z0,
      z1,
      floorY + 2,
      topY,
      'frame',
      `${label}上枠`,
      ['A-CLOSED-DOORS'],
    );
    box(
      `solid-${id}-leaf-closed`,
      doorX0,
      doorX1,
      z0,
      z0 + 0.035,
      floorY,
      floorY + 2,
      'door',
      `${label}・閉鎖固定`,
      ['A-CLOSED-DOORS'],
    );
  };
  closedWall(
    'entry-storage',
    -0.825,
    0.055,
    0.9,
    1.02,
    0,
    2.68,
    -0.74,
    -0.11,
    '玄関収納扉',
  );
  box(
    'solid-entry-storage-side',
    -0.055,
    0.055,
    1.02,
    1.52,
    PHYSICAL_BOTTOM_M,
    2.68,
    'wall',
    '玄関収納側面',
    ['A-CLOSED-DOORS'],
  );
  box(
    'solid-upper-hall-wall-left',
    -0.825,
    1.485,
    0.63,
    0.75,
    UPPER_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '2階直線廊下の左側壁・扉なし',
    ['A-UPPER-HALL', 'A-SOLIDS'],
  );
  box(
    'solid-upper-hall-wall-right',
    -0.055,
    1.485,
    1.52,
    1.64,
    UPPER_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '2階直線廊下の右側壁・扉なし',
    ['A-UPPER-HALL', 'A-SOLIDS'],
  );
  box(
    'solid-upper-hall-arrival-wall',
    -0.945,
    -0.825,
    0.63,
    1.52,
    UPPER_BOTTOM_M,
    WALL_TOP_M,
    'wall',
    '2階到着床の外側壁',
    ['A-UPPER-HALL', 'A-SOLIDS'],
  );
  box(
    'solid-ldk-jamb-left',
    1.485,
    1.605,
    0.63,
    0.775,
    UPPER_BOTTOM_M,
    WALL_TOP_M,
    'frame',
    'LDK入口左側枠',
    ['A-LDK'],
  );
  box(
    'solid-ldk-jamb-right',
    1.485,
    1.605,
    1.495,
    1.64,
    UPPER_BOTTOM_M,
    WALL_TOP_M,
    'frame',
    'LDK入口右側枠',
    ['A-LDK'],
  );
  box(
    'solid-ldk-header',
    1.485,
    1.605,
    0.775,
    1.495,
    5.055,
    WALL_TOP_M,
    'frame',
    'LDK入口上枠',
    ['A-LDK'],
  );
  box(
    'solid-ldk-leaf-open',
    1.605,
    2.325,
    1.495,
    1.531,
    3.07,
    5.045,
    'door',
    'LDK扉・室内側90度固定',
    ['A-LDK'],
  );

  const geometry: GeometryModel = {
    id: MAISONETTE_MODEL_VERSION,
    physicalSolids,
    floorRegions,
    portals,
    outerConstraint: {
      id: 'constraint-maisonette-outer',
      bounds: {
        min: { x: -12.05, y: -0.3, z: -10.035 },
        max: { x: 10.29, y: 14, z: 3.685 },
      },
    },
  };
  validateGeometryModel(geometry);
  const stepLedger = stepDrafts.map((step) => {
    const preceding = portals.find((p) => p.toRegionId === step.floorRegionId);
    const following = portals.find(
      (p) => p.fromRegionId === step.floorRegionId,
    );
    if (!preceding || !following) throw new Error('Unconnected housing step');
    return {
      ...step,
      precedingPortalId: preceding.id,
      followingPortalId: following.id,
    };
  });
  return {
    geometry,
    metadata: {
      modelVersion: MAISONETTE_MODEL_VERSION,
      assumptionSetId: MAISONETTE_ASSUMPTION_SET,
      measurementCount: 0,
      uncertainty: 'unknown',
      sourceRegistrationId: 'A-REGISTRATION',
    },
    openings: {
      entry: {
        id: 'opening-entry',
        normal: { x: 0, y: 0, z: 1 },
        approachPlaneM: -0.145,
        departurePlaneM: 0,
        floorHeightM: 0.018,
        clearWidthM: 0.77,
        clearHeightM: 2.04,
        widthAxis: 'x',
        transverseMinM: -0.385,
        transverseMaxM: 0.385,
        fixedDoorSolidId: 'solid-entry-leaf-open',
        epsilonM: TERMINAL_EPSILON_M,
      },
      ldk: {
        id: 'opening-ldk',
        normal: { x: 1, y: 0, z: 0 },
        approachPlaneM: 1.045,
        departurePlaneM: 1.165,
        floorHeightM: UPPER_FLOOR_M,
        clearWidthM: 0.72,
        clearHeightM: 2.005,
        widthAxis: 'z',
        transverseMinM: 0.775,
        transverseMaxM: 1.495,
        fixedDoorSolidId: 'solid-ldk-leaf-open',
        epsilonM: TERMINAL_EPSILON_M,
      },
    },
    guide,
    startRegionIds: [outside.id, outsideLeft.id],
    goalRegionId: receiver.id,
    startBounds: {
      min: { x: -1.265, y: -0.3, z: -1.85 },
      max: { x: 0.385, y: 14, z: -0.145 },
    },
    terminalReference: {
      regionId: receiver.id,
      normalDepthM: 9.01,
      straightOnly: true,
      physicalInteriorEvaluated: false,
    },
    assumptions: MAISONETTE_ASSUMPTIONS,
    stepLedger,
    elements,
    sourceRegistration: {
      id: 'A-REGISTRATION',
      certainty: 'assumed',
      description:
        '原点は玄関内側枠中央の土間面。+Zは玄関から内側、+Xはその視点の左。下側階段から奥で折り返し、−X側の上側階段を−Zへ戻る。利用者訂正により2階到着後に右（+X）へ曲がり、その先はLDK入口まで一直線・左右の扉なしと仮定する。写真と図面の実登録は未確認。',
    },
    unconfirmedItems: [
      '全住宅寸法の実測は0件で、図面概算の基準面と誤差は不明。',
      '写真と平面図の左右、階段上下、玄関と2階廊下の実際の座標登録。',
      '階高・全段数・各直段と回り段の頂点/高さ、段鼻の突出。',
      '中央腰壁の厚さ・天端勾配・笠木の幅/厚み/端部。',
      '玄関外の空間、敷居/框/土間、すべての扉と枠の寸法・固定姿勢。',
      '2階到着後に右折して直線廊下・左右の扉なしという仮定、幅・長さ・LDK入口配置は実住宅と未照合。',
      'LDK入口の先の床・壁・障害物、通過後の移動・設置は未評価。',
      '凸形状全般の数値誤差適用範囲、iOS Safari/Android Chrome実機性能。',
    ],
  };
}
