import RAPIER from '@dimforge/rapier3d-compat';
import { expect, it, vi } from 'vitest';
import { IDENTITY } from '../src/domain/pose';
import { createPhysicalQuery } from '../src/geometry/physical-query';
import { queryRapierDiagnostic } from '../src/geometry/rapier-diagnostic';
import { createRapierDiagnosticFactory } from '../src/geometry/rapier-diagnostic-factory';
import { initializeGeometry } from '../src/geometry/rapier-query';

it('keeps Rapier diagnostics opt-in and independent of physical bounds', async () => {
  const solid = {
    id: 'diagnostic-cube',
    footprint: [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ],
    bottomM: -1,
    topM: 1,
  } as const;
  const dimensions = { x: 1, y: 1, z: 1 } as const;
  const pose = {
    position: { x: 1.6, y: 0, z: 0 },
    rotation: IDENTITY,
  } as const;
  const plainQuery = await createPhysicalQuery([solid], dimensions);
  const diagnosticQuery = await createPhysicalQuery([solid], dimensions, {
    diagnosticFactory: createRapierDiagnosticFactory,
  });
  const plain = plainQuery.query(pose, 1);
  const diagnosed = diagnosticQuery.query(pose, 1);
  expect(diagnosticQuery.queryCollision?.(pose, 1)).toEqual(diagnosed);

  expect(plain).toMatchObject({
    diagnosticsEnabled: false,
    unmeasuredSolidIds: [],
    rapierRangeMismatchIds: [],
    rapierDistanceMismatchIds: [],
    rapierUnavailableSolidIds: [],
    rapierQueryFailureIds: [],
  });
  expect(diagnosed.diagnosticsEnabled).toBe(true);
  expect({
    status: diagnosed.status,
    lowerBoundM: diagnosed.lowerBoundM,
    upperBoundM: diagnosed.upperBoundM,
    obstacleId: diagnosed.obstacleId,
    limitingSolidId: diagnosed.limitingSolidId,
    intersectingSolidIds: diagnosed.intersectingSolidIds,
  }).toEqual({
    status: plain.status,
    lowerBoundM: plain.lowerBoundM,
    upperBoundM: plain.upperBoundM,
    obstacleId: plain.obstacleId,
    limitingSolidId: plain.limitingSolidId,
    intersectingSolidIds: plain.intersectingSolidIds,
  });
});

it('records an optional diagnostic callback failure without changing clear or blocked bounds', async () => {
  const solid = {
    id: 'diagnostic-failure-cube',
    footprint: [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ],
    bottomM: -1,
    topM: 1,
  } as const;
  const dimensions = { x: 1, y: 1, z: 1 } as const;
  const plain = await createPhysicalQuery([solid], dimensions);
  const diagnosed = await createPhysicalQuery([solid], dimensions, {
    diagnosticFactory: () =>
      Promise.resolve(() => {
        throw new Error('Injected optional diagnostic failure');
      }),
  });
  for (const x of [1.6, 0]) {
    const pose = { position: { x, y: 0, z: 0 }, rotation: IDENTITY };
    const expected = plain.query(pose, 1);
    expect(diagnosed.query(pose, 1)).toEqual({
      ...expected,
      diagnosticsEnabled: true,
      unmeasuredSolidIds: [solid.id],
      rapierQueryFailureIds: [solid.id],
    });
  }
});

it('releases every returned WASM shape, vector and rotation when the contact query throws', async () => {
  await initializeGeometry();
  const moving = new RAPIER.Cuboid(1, 1, 1),
    solid = new RAPIER.Cuboid(1, 1, 1);
  const rawMoving = moving.intoRaw(),
    rawSolid = solid.intoRaw();
  const allocationFrees: (() => number)[] = [];
  const observe = <T extends { free(): void }>(resource: T): T => {
    const lifecycle: { free(): void } = resource;
    const spy = vi.spyOn(lifecycle, 'free');
    allocationFrees.push(() => spy.mock.calls.length);
    return resource;
  };
  const intoVector = RAPIER.VectorOps.intoRaw.bind(RAPIER.VectorOps),
    intoRotation = RAPIER.RotationOps.intoRaw.bind(RAPIER.RotationOps);
  try {
    vi.spyOn(moving, 'intoRaw').mockReturnValue(observe(rawMoving));
    vi.spyOn(solid, 'intoRaw').mockReturnValue(observe(rawSolid));
    vi.spyOn(RAPIER.VectorOps, 'intoRaw').mockImplementation((v) =>
      observe(intoVector(v)),
    );
    vi.spyOn(RAPIER.RotationOps, 'intoRaw').mockImplementation((q) =>
      observe(intoRotation(q)),
    );
    vi.spyOn(rawMoving, 'contactShape').mockImplementation(() => {
      throw new Error('Injected diagnostic failure');
    });
    expect(
      queryRapierDiagnostic(
        moving,
        IDENTITY,
        solid,
        { x: 3, y: 0, z: 0 },
        2,
        1,
      ),
    ).toEqual({ kind: 'query-failed', distanceM: null });
    expect(allocationFrees).toHaveLength(6);
    expect(allocationFrees.map((count) => count())).toEqual([1, 1, 1, 1, 1, 1]);
  } finally {
    vi.restoreAllMocks();
  }
});

it('releases the returned contact as well when reading its components fails', async () => {
  await initializeGeometry();
  const moving = new RAPIER.Cuboid(1, 1, 1),
    solid = new RAPIER.Cuboid(1, 1, 1);
  const rawMoving = moving.intoRaw();
  const originalContact = rawMoving.contactShape.bind(rawMoving);
  let contactFreeCount = () => 0;
  try {
    vi.spyOn(moving, 'intoRaw').mockReturnValue(rawMoving);
    vi.spyOn(rawMoving, 'contactShape').mockImplementation((...args) => {
      const contact = originalContact(...args);
      if (!contact) throw new Error('Expected measured diagnostic contact');
      const free = vi.spyOn(contact, 'free');
      contactFreeCount = () => free.mock.calls.length;
      vi.spyOn(contact, 'getComponents').mockImplementation(() => {
        throw new Error('Injected diagnostic component failure');
      });
      return contact;
    });
    expect(
      queryRapierDiagnostic(
        moving,
        IDENTITY,
        solid,
        { x: 3, y: 0, z: 0 },
        2,
        1,
      ),
    ).toEqual({ kind: 'query-failed', distanceM: null });
    expect(contactFreeCount()).toBe(1);
  } finally {
    vi.restoreAllMocks();
  }
});
