import type { ViewerEnvironment } from '../viewer/create-route-viewer';

// Display-only assumptions in metres. These are not measured housing dimensions
// and this development fixture is never passed to the calculation Worker.
export const STRAIGHT_CORRIDOR: ViewerEnvironment = {
  center: { x: 0, y: 1.2, z: 0 },
  radius: Math.hypot(1.2, 2.5, 6) / 2,
  description:
    '開発表示用の一直線の廊下。仮定寸法は有効幅1000mm、長さ6000mm、壁高2400mm、壁厚100mm。天井・扉・段差はありません。実住宅の搬入判定には使いません。',
  cuboids: [
    {
      surface: 'floor',
      dimensions: { x: 1.2, y: 0.1, z: 6 },
      position: { x: 0, y: -0.05, z: 0 },
    },
    {
      surface: 'wall',
      dimensions: { x: 0.1, y: 2.4, z: 6 },
      position: { x: -0.55, y: 1.2, z: 0 },
    },
    {
      surface: 'wall',
      dimensions: { x: 0.1, y: 2.4, z: 6 },
      position: { x: 0.55, y: 1.2, z: 0 },
    },
  ],
};
