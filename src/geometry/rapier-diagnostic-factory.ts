import RAPIER from '@dimforge/rapier3d-compat';
import type { Pose, Vector3 } from '../domain/pose';
import { prismVertices, type ConvexPrism } from '../model/geometry-model';
import type { PhysicalDiagnosticCallback } from './query-types';
import { initializeGeometry } from './rapier-query';
import { queryRapierDiagnostic } from './rapier-diagnostic';

const SCALE = 1000;

/** Prepares optional Rapier diagnostics without making them part of product queries. */
export async function createRapierDiagnosticFactory(
  solids: readonly ConvexPrism[],
  dimensions: Vector3,
): Promise<PhysicalDiagnosticCallback> {
  await initializeGeometry();
  const moving = new RAPIER.Cuboid(
    (dimensions.x * SCALE) / 2,
    (dimensions.y * SCALE) / 2,
    (dimensions.z * SCALE) / 2,
  );
  const shapes = new Map(
    solids.map((solid) => {
      const vertices = prismVertices(solid);
      const center = {
        x:
          (Math.min(...vertices.map((vertex) => vertex.x)) +
            Math.max(...vertices.map((vertex) => vertex.x))) /
          2,
        y: (solid.bottomM + solid.topM) / 2,
        z:
          (Math.min(...vertices.map((vertex) => vertex.z)) +
            Math.max(...vertices.map((vertex) => vertex.z))) /
          2,
      };
      const shape = new RAPIER.ConvexPolyhedron(
        new Float32Array(
          vertices.flatMap((vertex) => [
            (vertex.x - center.x) * SCALE,
            (vertex.y - center.y) * SCALE,
            (vertex.z - center.z) * SCALE,
          ]),
        ),
      );
      return [solid.id, { shape, center }] as const;
    }),
  );

  return (solidId: string, pose: Pose, predictionM: number) => {
    const solid = shapes.get(solidId);
    if (!solid) throw new Error(`Unknown diagnostic solid: ${solidId}`);
    return queryRapierDiagnostic(
      moving,
      pose.rotation,
      solid.shape,
      {
        x: (solid.center.x - pose.position.x) * SCALE,
        y: (solid.center.y - pose.position.y) * SCALE,
        z: (solid.center.z - pose.position.z) * SCALE,
      },
      predictionM * SCALE,
      SCALE,
    );
  };
}
