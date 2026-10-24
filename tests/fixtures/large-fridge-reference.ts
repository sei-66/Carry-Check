import type { FloorState } from '../../src/geometry/floor-motion';

// An independently found and continuously checked path in assumed maisonette v3.
// Input: 660 × 708 × 1910 mm, margin 10 mm. These are a geometric regression,
// not a field measurement or a manufacturer-approved carrying orientation.
export const LARGE_FRIDGE_REFERENCE = [
  {
    floorRegionId: 'region-entry-outside',
    pose: {
      position: {
        x: 0,
        y: 1.005,
        z: -0.9975,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-entry-threshold',
    pose: {
      position: {
        x: 0,
        y: 1.023,
        z: -0.0725,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-doma',
    pose: {
      position: {
        x: 0,
        y: 1.005,
        z: 0.45,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-doma',
    pose: {
      position: {
        x: 0,
        y: 1.535,
        z: 0.45,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-pre-stair',
    pose: {
      position: {
        x: 0,
        y: 1.6949999999999998,
        z: 1.21,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-001',
    pose: {
      position: {
        x: 0,
        y: 1.8649999999999998,
        z: 1.635,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-002',
    pose: {
      position: {
        x: 0,
        y: 1.835,
        z: 1.98,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-003',
    pose: {
      position: {
        x: 0,
        y: 2.245,
        z: 2.0949999999999998,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-004',
    pose: {
      position: {
        x: 0,
        y: 2.415,
        z: 2.3249999999999997,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-005',
    pose: {
      position: {
        x: 0,
        y: 2.585,
        z: 2.5549999999999997,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-006',
    pose: {
      position: {
        x: 0,
        y: 2.755,
        z: 2.78075,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-007',
    pose: {
      position: {
        x: 0,
        y: 2.9250000000000003,
        z: 3.1,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-008',
    pose: {
      position: {
        x: -0.31124999999999997,
        y: 3.095,
        z: 3.1,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-009',
    pose: {
      position: {
        x: -0.56875,
        y: 3.265,
        z: 3.1,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-010',
    pose: {
      position: {
        x: -0.88,
        y: 3.395,
        z: 3.1,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-011',
    pose: {
      position: {
        x: -0.8999999999999998,
        y: 3.525,
        z: 2.7044999999999995,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865475,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-013',
    pose: {
      position: {
        x: -0.8999999999999998,
        y: 3.745,
        z: 2.404499999999999,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865475,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-014',
    pose: {
      position: {
        x: -0.8799999999999999,
        y: 4.075,
        z: 2.0949999999999998,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-015',
    pose: {
      position: {
        x: -0.8799999999999999,
        y: 4.245,
        z: 1.8650000000000002,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-step-016',
    pose: {
      position: {
        x: -0.8799999999999999,
        y: 4.415,
        z: 1.635,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-upper-hall-arrival',
    pose: {
      position: {
        x: -0.8799999999999999,
        y: 4.585,
        z: 1.135,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-upper-hall-middle',
    pose: {
      position: {
        x: -0.11,
        y: 4.585,
        z: 1.135,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-upper-hall-approach',
    pose: {
      position: {
        x: 0.66,
        y: 4.045,
        z: 1.135,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-ldk-threshold',
    pose: {
      position: {
        x: 1.105,
        y: 4.045,
        z: 1.135,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
  {
    floorRegionId: 'region-ldk-receiver',
    pose: {
      position: {
        x: 1.54,
        y: 4.045,
        z: 1.135,
      },
      rotation: {
        x: 0,
        y: 0.7071067811865476,
        z: 0,
        w: 0.7071067811865476,
      },
    },
  },
] satisfies readonly FloorState[];
