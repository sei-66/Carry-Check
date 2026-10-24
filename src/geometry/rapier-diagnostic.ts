import RAPIER, { type Shape } from '@dimforge/rapier3d-compat';
import { IDENTITY, type Quaternion, type Vector3 } from '../domain/pose';
import type { PhysicalDiagnostic } from './query-types';

export type RapierDiagnostic = PhysicalDiagnostic;

// Pinned Rapier 0.21.0 raw adapter: Shape.contactShape lacks finally and its
// convexHull factory may return undefined despite Shape.intoRaw's declaration.
// Own every returned WASM allocation here, including failure paths. Diagnostics
// never supply the independent geometric bounds or a collision certificate.
export function queryRapierDiagnostic(
  moving: Shape,
  rotation: Quaternion,
  solid: Shape,
  relativePosition: Vector3,
  prediction: number,
  scale: number,
): RapierDiagnostic {
  const resources: { free(): void }[] = [];
  const keep = <T extends { free(): void }>(resource: T): T => {
    resources.push(resource);
    return resource;
  };
  let result: RapierDiagnostic = { kind: 'query-failed', distanceM: null };
  try {
    const rawMoving = moving.intoRaw();
    if (rawMoving) keep(rawMoving);
    const rawSolid = solid.intoRaw();
    if (rawSolid) keep(rawSolid);
    if (!rawMoving || !rawSolid) {
      result = { kind: 'shape-unavailable', distanceM: null };
    } else {
      const pos1 = keep(RAPIER.VectorOps.intoRaw({ x: 0, y: 0, z: 0 }));
      const rot1 = keep(RAPIER.RotationOps.intoRaw(rotation));
      const pos2 = keep(RAPIER.VectorOps.intoRaw(relativePosition));
      const rot2 = keep(RAPIER.RotationOps.intoRaw(IDENTITY));
      const contact = rawMoving.contactShape(
        pos1,
        rot1,
        rawSolid,
        pos2,
        rot2,
        prediction,
      );
      if (contact) {
        keep(contact);
        // Rapier 0.21.0 layout: distance + four 3D contact components.
        const components = new Float32Array(13);
        contact.getComponents(components);
        const distanceM = components[0]! / scale;
        if (Number.isFinite(distanceM))
          result = { kind: 'measured', distanceM };
      } else {
        result = { kind: 'out-of-range', distanceM: null };
      }
    }
  } catch {
    result = { kind: 'query-failed', distanceM: null };
  } finally {
    for (const resource of resources.reverse()) {
      try {
        resource.free();
      } catch {
        result = { kind: 'query-failed', distanceM: null };
      }
    }
  }
  return result;
}
