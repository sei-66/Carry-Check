import type { Vector3 } from '../domain/pose';
import type { HousingOpening } from './maisonette-model';

/** Distance from the entry's outside face to the cargo centre at route start. */
export const ENTRY_START_DISTANCE_M = 1;

export function entryStartCenterPlaneDot(opening: HousingOpening): number {
  const normalLength = Math.hypot(
    opening.normal.x,
    opening.normal.y,
    opening.normal.z,
  );
  return opening.approachPlaneM - ENTRY_START_DISTANCE_M * normalLength;
}

export function entryStartCenterPosition(
  opening: HousingOpening,
  transverse: number,
  centerHeight: number,
): Vector3 {
  const { normal } = opening;
  const planeDot = entryStartCenterPlaneDot(opening);
  if (opening.widthAxis === 'x') {
    if (Math.abs(normal.z) < 1e-12) throw new Error('Invalid opening normal');
    return {
      x: transverse,
      y: centerHeight,
      z:
        (planeDot - normal.x * transverse - normal.y * centerHeight) / normal.z,
    };
  }
  if (Math.abs(normal.x) < 1e-12) throw new Error('Invalid opening normal');
  return {
    x: (planeDot - normal.y * centerHeight - normal.z * transverse) / normal.x,
    y: centerHeight,
    z: transverse,
  };
}
