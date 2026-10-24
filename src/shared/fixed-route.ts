export const FIXED_ROUTE = {
  id: 'maisonette-entry-stairs-room',
  direction: 'entry-to-room',
  modelVersion: 'maisonette-assumed-v3',
} as const;

export const FIXED_ROUTE_METADATA = {
  routeId: FIXED_ROUTE.id,
  direction: FIXED_ROUTE.direction,
  modelVersion: FIXED_ROUTE.modelVersion,
} as const;

export type FixedRouteId = typeof FIXED_ROUTE.id;
export type FixedRouteDirection = typeof FIXED_ROUTE.direction;
export type FixedRouteModelVersion = typeof FIXED_ROUTE.modelVersion;
