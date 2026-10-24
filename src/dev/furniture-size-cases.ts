import type { InputSnapshot } from '../domain/dimensions';

interface FurnitureSizeCase {
  readonly name: string;
  readonly basis: string;
  readonly input: InputSnapshot;
}

// Official dimension sources and assumptions: docs/furniture-verification.md.
// Appliance packaging is assumed to add 30 mm per face, separately from margin.
export const FURNITURE_SIZE_CASES: readonly FurnitureSizeCase[] = (
  [
    ['MALM 2段チェスト', '公開梱包寸法', 470, 570, 130],
    ['BILLY 本棚', '公開梱包寸法', 390, 2060, 70],
    ['LACK テーブル', '公開梱包寸法', 660, 910, 60],
    ['MICKE デスク', '公開梱包寸法', 750, 1140, 100],
    ['KIVIK 2人掛けソファ', '2梱包中の大きい1梱包のみ', 910, 1460, 570],
    ['VESTERÖY マットレス', 'ロール梱包の直方体包絡', 400, 400, 1010],
    ['NE-FL1C 電子レンジ', '外寸＋仮定梱包60mm/軸', 548, 465, 358],
    ['F-VXW55 空気清浄機', '外寸＋仮定梱包60mm/軸', 420, 298, 622],
    ['NR-B18C3 小型冷蔵庫', '外寸＋仮定梱包60mm/軸', 557, 655, 1410],
    ['NR-E41RY3 大型冷蔵庫', '外寸＋仮定梱包60mm/軸', 660, 708, 1910],
    ['NA-FA7H5 縦型洗濯機', '外寸＋仮定梱包60mm/軸', 624, 633, 1082],
    ['NA-LX113E ドラム洗濯機', '外寸＋仮定梱包60mm/軸', 699, 782, 1120],
  ] as const
).map(([name, basis, widthMm, depthMm, heightMm]) => ({
  name,
  basis,
  input: {
    widthMm,
    depthMm,
    heightMm,
    marginMm: 10,
  },
}));
