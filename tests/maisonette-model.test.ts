import { describe, expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import { IDENTITY, type Pose } from '../src/domain/pose';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import { createPhysicalQuery } from '../src/geometry/physical-query';
import {
  createModelQuery,
  footprintLocation,
} from '../src/geometry/model-query';
import {
  validateGeometryModel,
  type PointXZ,
} from '../src/model/geometry-model';
import {
  createMaisonetteModel,
  MAISONETTE_MODEL_VERSION,
} from '../src/model/maisonette-model';
import { FIXED_ROUTE } from '../src/shared/fixed-route';

const model = createMaisonetteModel();

function area(points: readonly PointXZ[]): number {
  return (
    Math.abs(
      points.reduce((sum, a, index) => {
        const b = points[(index + 1) % points.length];
        if (!b) throw new Error('Missing oracle vertex');
        return sum + a.x * b.z - b.x * a.z;
      }, 0),
    ) / 2
  );
}

describe('assumed maisonette model', () => {
  it('tiles the full rectangular start bounds with the exterior floor regions', () => {
    const bounds = model.startBounds;
    const exterior = model.geometry.floorRegions
      .filter((region) => model.startRegionIds.includes(region.id))
      .map((region) => ({
        region,
        minX: Math.min(...region.footprint.map((point) => point.x)),
        maxX: Math.max(...region.footprint.map((point) => point.x)),
      }))
      .sort((left, right) => left.minX - right.minX);
    expect(exterior).toHaveLength(2);
    for (const { region, minX, maxX } of exterior) {
      expect(region.floorHeightM).toBe(0);
      expect(region.footprint).toHaveLength(4);
      expect(Math.min(...region.footprint.map((point) => point.z))).toBe(
        bounds.min.z,
      );
      expect(Math.max(...region.footprint.map((point) => point.z))).toBe(
        bounds.max.z,
      );
      expect(area(region.footprint)).toBeCloseTo(
        (maxX - minX) * (bounds.max.z - bounds.min.z),
        10,
      );
    }
    expect(exterior[0]?.minX).toBe(bounds.min.x);
    expect(exterior[0]?.maxX).toBe(exterior[1]?.minX);
    expect(exterior[1]?.maxX).toBe(bounds.max.x);
  });

  it('identifies its own assumption snapshot and preserves zero measurements', () => {
    expect(MAISONETTE_MODEL_VERSION).toBe('maisonette-assumed-v3');
    expect(FIXED_ROUTE.modelVersion).toBe(MAISONETTE_MODEL_VERSION);
    expect(model.metadata.assumptionSetId).toBe('A-MAISONETTE-2026-10-07-v3');
    expect(model.metadata.measurementCount).toBe(0);
    expect(model.metadata.uncertainty).toBe('unknown');
    expect(model.sourceRegistration.certainty).toBe('assumed');
    expect(model.assumptions.length).toBeGreaterThan(10);
    expect(
      model.assumptions.every(
        (a) =>
          a.certainty === 'assumed' && a.modelVersion === model.geometry.id,
      ),
    ).toBe(true);
    expect(() => validateGeometryModel(model.geometry)).not.toThrow();
  });

  it('covers every required dimension group without promoting source estimates', () => {
    const covered = new Set(model.assumptions.flatMap((a) => a.dimensionIds));
    for (const id of [
      'D-ST-W',
      'D-TURN-W',
      'D-TURN-D',
      'D-ENTRY-W',
      'D-ENTRY-H',
      'D-ENTRY-T',
      'D-ENTRY-LEAF',
      'D-OUTSIDE',
      'D-DOMA',
      'D-KAMACHI',
      'D-PRE-STAIR',
      'D-STAIR-COUNT',
      'D-FLOOR-RISE',
      'D-RISER-i',
      'D-TREAD-i',
      'D-WINDER-i',
      'D-WAIST-PLAN',
      'D-WAIST-TOP',
      'D-WAIST-CAP',
      'D-WALL-j',
      'D-UPPER-EXIT',
      'D-UPPER-HALL',
      'D-LDK-OPEN',
      'D-LDK-LEAF',
      'D-HALL-LEAVES',
    ]) {
      expect(covered.has(id), id).toBe(true);
    }
    const ids = new Set(model.assumptions.map((a) => a.id));
    for (const element of model.elements) {
      expect(element.assumptionIds.length, element.id).toBeGreaterThan(0);
      expect(
        element.assumptionIds.every((id) => ids.has(id)),
        element.id,
      ).toBe(true);
    }
    expect(new Set(model.elements.map((e) => e.id))).toEqual(
      new Set(model.geometry.physicalSolids.map((s) => s.id)),
    );
  });

  it('keeps six unequal-height winders and closes their plan area around the waist', () => {
    const steps = model.stepLedger;
    expect(steps.map((s) => s.kind)).toEqual([
      ...Array<string>(5).fill('lower-straight'),
      ...Array<string>(6).fill('winder'),
      ...Array<string>(5).fill('upper-straight'),
    ]);
    const winders = steps.filter((s) => s.kind === 'winder');
    expect(winders.map((s) => s.floorHeightM)).toEqual([
      1.18, 1.35, 1.52, 1.69, 1.86, 2.03,
    ]);
    expect(winders.reduce((sum, s) => sum + area(s.footprint), 0)).toBeCloseTo(
      1.65 * 0.775 - 0.11 * 0.055,
      12,
    );
    for (const [index, step] of steps.entries()) {
      expect(
        step.floorHeightM - (steps[index - 1]?.floorHeightM ?? 0.16),
      ).toBeCloseTo(0.17, 12);
      expect(
        model.geometry.portals.some((p) => p.id === step.precedingPortalId),
      ).toBe(true);
      expect(
        model.geometry.portals.some((p) => p.id === step.followingPortalId),
      ).toBe(true);
    }
    expect(model.openings.ldk.floorHeightM - 0.16).toBeCloseTo(17 * 0.17, 12);
    expect(
      model.geometry.portals.some(
        (p) =>
          p.fromRegionId === 'region-step-005' &&
          p.toRegionId === 'region-step-012',
      ),
    ).toBe(false);
  });

  it('models frames, the fixed leaves, solid risers, waist and projecting caps', () => {
    const byId = new Map(model.geometry.physicalSolids.map((s) => [s.id, s]));
    expect(byId.get('solid-entry-header')?.bottomM).toBe(2.058);
    expect(byId.get('solid-ldk-header')?.bottomM).toBe(5.055);
    expect(byId.get('solid-floor-pre-stair')?.topM).toBe(0.16);
    expect(byId.get('solid-floor-doma')?.topM).toBe(0);
    expect(byId.get('solid-waist-tip')?.topM).toBe(3.03);
    expect(byId.get('solid-waist-cap-tip')?.topM).toBe(3.062);
    const ldkLeaf = byId.get('solid-ldk-leaf-open');
    expect(
      (ldkLeaf?.bottomM ?? 0) - model.openings.ldk.floorHeightM,
    ).toBeCloseTo(0.02, 12);
    expect(
      (byId.get('solid-ldk-header')?.bottomM ?? 0) - (ldkLeaf?.topM ?? 0),
    ).toBeCloseTo(0.01, 12);
    expect(
      model.elements.filter((e) => e.kind === 'door').map((e) => e.id),
    ).toEqual([
      'solid-entry-leaf-open',
      'solid-entry-storage-leaf-closed',
      'solid-ldk-leaf-open',
    ]);
    const cap = byId.get('solid-waist-cap-tip');
    expect(cap).toBeDefined();
    if (!cap) throw new Error('Missing cap');
    expect(
      Math.max(...cap.footprint.map((p) => p.x)) -
        Math.min(...cap.footprint.map((p) => p.x)),
    ).toBeCloseTo(0.15, 12);
    expect(Math.max(...cap.footprint.map((p) => p.z))).toBe(2.745);
  });

  it('uses a virtual finite receiver and represents the entire frame thickness', () => {
    const receiver = model.geometry.floorRegions.find(
      (r) => r.id === model.goalRegionId,
    );
    expect(receiver?.physicalSolidId).toBeNull();
    expect(receiver?.basis).toBe('terminal-reference');
    expect(model.terminalReference.physicalInteriorEvaluated).toBe(false);
    expect(model.terminalReference.straightOnly).toBe(true);
    expect(model.terminalReference.normalDepthM).toBeGreaterThan(
      Math.sqrt(3) * 5.2 + model.openings.ldk.epsilonM,
    );
    expect(
      model.openings.entry.departurePlaneM -
        model.openings.entry.approachPlaneM,
    ).toBeCloseTo(0.145, 12);
    expect(
      model.openings.ldk.departurePlaneM - model.openings.ldk.approachPlaneM,
    ).toBeCloseTo(0.12, 12);
    expect(
      model.geometry.physicalSolids.some((s) => s.id.includes('receiver')),
    ).toBe(false);
    if (!receiver) throw new Error('Missing receiver');
    const bounds = model.geometry.outerConstraint.bounds;
    for (const corner of receiver.footprint) {
      expect(corner.x).toBeGreaterThan(bounds.min.x);
      expect(corner.x).toBeLessThan(bounds.max.x);
      expect(corner.z).toBeGreaterThan(bounds.min.z);
      expect(corner.z).toBeLessThan(bounds.max.z);
    }
    expect(Math.min(...receiver.footprint.map((p) => p.x))).toBe(1.165);
    expect(Math.max(...receiver.footprint.map((p) => p.x))).toBe(10.175);
    expect(model.openings.ldk).toMatchObject({
      normal: { x: 1, y: 0, z: 0 },
      approachPlaneM: 1.045,
      departurePlaneM: 1.165,
      widthAxis: 'z',
      transverseMinM: 0.775,
      transverseMaxM: 1.495,
    });
    expect(Math.min(...receiver.footprint.map((p) => p.z))).toBe(0.775);
    expect(Math.max(...receiver.footprint.map((p) => p.z))).toBe(1.495);
    expect(
      Math.max(...receiver.footprint.map((p) => p.x)) -
        Math.min(...receiver.footprint.map((p) => p.x)),
    ).toBeCloseTo(model.terminalReference.normalDepthM, 12);
    const threshold = model.geometry.floorRegions.find(
      (region) => region.id === 'region-ldk-threshold',
    );
    if (!threshold) throw new Error('Missing LDK threshold');
    expect(Math.min(...threshold.footprint.map((p) => p.x))).toBe(
      model.openings.ldk.approachPlaneM,
    );
    expect(Math.max(...threshold.footprint.map((p) => p.x))).toBe(
      model.openings.ldk.departurePlaneM,
    );
  });

  it('turns right from the top step, then follows a straight hall with no side doors', () => {
    const hall = model.geometry.floorRegions.filter((r) =>
      r.id.startsWith('region-upper-hall-'),
    );
    expect(hall).toHaveLength(5);
    expect(hall.reduce((sum, r) => sum + area(r.footprint), 0)).toBeCloseTo(
      0.77 * 2.31,
      12,
    );
    for (const region of hall) {
      expect(region.floorHeightM).toBe(3.05);
      for (const p of region.footprint) {
        expect(p.x).toBeGreaterThanOrEqual(-1.265);
        expect(p.x).toBeLessThanOrEqual(1.045);
        expect(p.z).toBeGreaterThanOrEqual(0.75);
        expect(p.z).toBeLessThanOrEqual(1.52);
      }
    }
    // Sample every partition at interior cross-sections to detect overlap or
    // an unrepresented strip independently of the summed polygon areas.
    for (const x of [-1.26, -0.9, -0.5, -0.1, 0.3, 0.7, 1.04])
      for (const z of [0.755, 0.78, 1.135, 1.49, 1.515])
        expect(
          hall.filter(
            (r) => footprintLocation(r.footprint, { x, z }) === 'inside',
          ),
          `${x},${z}`,
        ).toHaveLength(1);

    const guides = model.guide.filter((p) =>
      ['upper-hall', 'ldk'].includes(p.stage),
    );
    const lastStep = model.guide.filter((p) => p.stage === 'stairs').at(-1);
    expect(lastStep).toBeDefined();
    const arrival = guides[0];
    if (!arrival || !lastStep) throw new Error('Missing upper arrival guides');
    expect(arrival.positionXZ.x).toBeCloseTo(lastStep.positionXZ.x, 12);
    expect(arrival.positionXZ.z).toBeLessThan(lastStep.positionXZ.z);
    // +X is left when entering along +Z, hence right when returning along -Z.
    for (const [index, guide] of guides.entries()) {
      expect(guide.positionXZ.z).toBeCloseTo(1.135, 12);
      if (index > 0)
        expect(guide.positionXZ.x).toBeGreaterThan(
          guides[index - 1]?.positionXZ.x ?? Infinity,
        );
    }

    const byId = new Map(model.geometry.physicalSolids.map((s) => [s.id, s]));
    for (const id of [
      'solid-upper-hall-wall-left',
      'solid-upper-hall-wall-right',
    ]) {
      const wall = byId.get(id);
      if (!wall) throw new Error('Missing upper hall side wall');
      expect(Math.max(...wall.footprint.map((p) => p.x))).toBe(1.045);
      expect(wall.bottomM).toBeLessThanOrEqual(3.05);
      expect(wall.topM).toBeGreaterThan(
        model.geometry.outerConstraint.bounds.max.y,
      );
    }
    expect(
      model.elements.some((e) => /upper-storage|washroom|toilet/.test(e.id)),
    ).toBe(false);
    expect(byId.get('solid-entry-jamb-left')?.topM).toBeGreaterThan(
      model.geometry.outerConstraint.bounds.max.y,
    );
    expect(model.openings.entry).toMatchObject({
      normal: { x: 0, y: 0, z: 1 },
      clearWidthM: 0.77,
      clearHeightM: 2.04,
      approachPlaneM: -0.145,
      departurePlaneM: 0,
    });
    expect(
      model.assumptions.find((a) => a.id === 'A-UPPER-HALL')?.sourceIds,
    ).toEqual(['U2', 'U3']);
  });

  it('closes the obsolete straight exit and keeps the new right-turn passage above the lower wall', async () => {
    const validated = validateInputSnapshot({
      widthMm: 120,
      depthMm: 180,
      heightMm: 140,
      marginMm: 10,
    });
    if (!validated.ok) throw new Error('Invalid turn probe dimensions');
    const physical = await createPhysicalQuery(
      model.geometry.physicalSolids,
      validated.value.clearance,
    );
    // Continuing -Z past the arrival square now meets the corridor side wall.
    expect(
      physical.query(
        { position: { x: -0.88, y: 3.5, z: 0.7 }, rotation: IDENTITY },
        0.3,
      ).status,
    ).toBe('blocked');
    // The old artificial extension at X=.385..505 cannot divide the +X hall.
    expect(
      physical.query(
        { position: { x: 0.445, y: 3.5, z: 1.135 }, rotation: IDENTITY },
        0.3,
      ).status,
    ).toBe('clear');
    expect(
      physical.query(
        { position: { x: 0.445, y: 1, z: 1.135 }, rotation: IDENTITY },
        0.3,
      ).status,
    ).toBe('blocked');
    const underHall = model.geometry.physicalSolids.find(
      (solid) => solid.id === 'solid-wall-entry-side-under-upper-hall',
    );
    expect(underHall?.topM).toBe(2.88);
  });

  it('gives connected interior guide points without using the central wall as a shortcut', () => {
    for (const [index, guide] of model.guide.entries()) {
      const region = model.geometry.floorRegions.find(
        (r) => r.id === guide.floorRegionId,
      );
      expect(region).toBeDefined();
      if (!region) throw new Error('Missing guide region');
      expect(
        footprintLocation(region.footprint, guide.positionXZ),
        guide.floorRegionId,
      ).toBe('inside');
      const previous = model.guide[index - 1];
      if (previous)
        expect(
          model.geometry.portals.some(
            (p) =>
              (p.fromRegionId === previous.floorRegionId &&
                p.toRegionId === guide.floorRegionId) ||
              (p.toRegionId === previous.floorRegionId &&
                p.fromRegionId === guide.floorRegionId),
          ),
          `${previous.floorRegionId} -> ${guide.floorRegionId}`,
        ).toBe(true);
    }
    expect(model.guide.filter((p) => p.stage === 'stairs')).toHaveLength(16);
  });

  it('separates stacked ground and upper floors with distinct physical slabs', () => {
    const doma = model.geometry.floorRegions.find(
      (r) => r.id === 'region-doma-side',
    );
    const upper = model.geometry.floorRegions.find(
      (r) => r.id === 'region-upper-hall-arrival',
    );
    if (!doma || !upper) throw new Error('Missing stacked floors');
    const at = { x: -0.88, z: 0.84 };
    expect(footprintLocation(doma.footprint, at)).toBe('inside');
    expect(footprintLocation(upper.footprint, at)).toBe('inside');
    expect(upper.floorHeightM - doma.floorHeightM).toBe(3.05);
    expect(
      model.geometry.physicalSolids.find((s) => s.id === upper.physicalSolidId)
        ?.bottomM,
    ).toBe(2.88);
    expect(
      model.geometry.portals.some(
        (p) =>
          [p.fromRegionId, p.toRegionId].includes(doma.id) &&
          [p.fromRegionId, p.toRegionId].includes(upper.id),
      ),
    ).toBe(false);
  });

  it('closes the physical joint between the last tread and the upper slab', async () => {
    const last = model.geometry.physicalSolids.find(
      (s) => s.id === 'solid-floor-step-016',
    );
    const arrival = model.geometry.physicalSolids.find(
      (s) => s.id === 'solid-floor-upper-hall-arrival',
    );
    if (!last || !arrival) throw new Error('Missing arrival joint');
    expect(arrival.bottomM).toBeLessThanOrEqual(last.topM);
    const physical = await createPhysicalQuery([arrival], {
      x: 0.004,
      y: 0.004,
      z: 0.004,
    });
    expect(
      physical.query(
        { position: { x: -0.88, y: 2.885, z: 1.51 }, rotation: IDENTITY },
        0.05,
      ).status,
    ).toBe('blocked');
  });

  it('keeps the entry wall closed after the obsolete upper slab moves away', async () => {
    const validated = validateInputSnapshot({
      widthMm: 120,
      depthMm: 120,
      heightMm: 4000,
      marginMm: 10,
    });
    if (!validated.ok) throw new Error('Invalid entry wall probe dimensions');
    const query = await createModelQuery(model.geometry, validated.value);
    // A tall item can keep its bottom within the outside lift limit while its
    // tilted upper end crosses the left wall above the old slab underside.
    // The v2 slab occupied that space; v3 must close its obsolete wall notch.
    const angle = (20 * Math.PI) / 180;
    const probe: Pose = {
      position: { x: -0.88, y: 2.12, z: -0.58 },
      rotation: { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) },
    };
    const result = query.query(probe, 'region-entry-outside-side', 0.3);
    expect(result.virtualViolationIds).toEqual([]);
    expect(result.clearance.status).toBe('blocked');
    expect(result.clearance.intersectingSolidIds).toContain(
      'solid-entry-jamb-left',
    );
  });

  it('admits the entire small-box reference route under physical and floor constraints', async () => {
    const validated = validateInputSnapshot({
      widthMm: 120,
      depthMm: 180,
      heightMm: 140,
      marginMm: 10,
    });
    if (!validated.ok) throw new Error('Invalid reference dimensions');
    const query = await createModelQuery(model.geometry, validated.value);
    const states = model.guide.map((guide) => ({
      floorRegionId: guide.floorRegionId,
      pose: {
        position: { ...guide.positionXZ, y: guide.floorHeightM + 0.38 + 0.07 },
        rotation: IDENTITY,
      } satisfies Pose,
    }));
    for (const [index, state] of states.entries()) {
      const answer = query.query(state.pose, state.floorRegionId, 0.3);
      expect(answer.virtualViolationIds, state.floorRegionId).toEqual([]);
      expect(answer.clearance.status, state.floorRegionId).toBe('clear');
      const previous = states[index - 1];
      if (previous)
        expect(
          verifyModelMotion(query, previous, state),
          `${previous.floorRegionId} -> ${state.floorRegionId}`,
        ).toMatchObject({ status: 'verified' });
    }
  }, 30000);
});
