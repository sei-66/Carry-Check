/** Housing-specific assumptions; none of these values is a field measurement. */
export const MAISONETTE_MODEL_VERSION = 'maisonette-assumed-v3' as const;
export const MAISONETTE_ASSUMPTION_SET = 'A-MAISONETTE-2026-10-07-v3' as const;

export interface HousingAssumption {
  readonly id: string;
  readonly dimensionIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly adoptedValue: string;
  readonly reference: string;
  readonly reason: string;
  readonly affectedStages: readonly string[];
  readonly certainty: 'assumed';
  readonly uncertainty: 'unknown';
  readonly adoption: 'assumed-housing-model';
  readonly modelVersion: typeof MAISONETTE_MODEL_VERSION;
}

function assumption(
  id: string,
  dimensionIds: readonly string[],
  sourceIds: readonly string[],
  adoptedValue: string,
  reference: string,
  reason: string,
  affectedStages: readonly string[],
): HousingAssumption {
  return {
    id,
    dimensionIds,
    sourceIds,
    adoptedValue,
    reference,
    reason,
    affectedStages,
    certainty: 'assumed',
    uncertainty: 'unknown',
    adoption: 'assumed-housing-model',
    modelVersion: MAISONETTE_MODEL_VERSION,
  };
}

export const MAISONETTE_ASSUMPTIONS: readonly HousingAssumption[] = [
  assumption(
    'A-REGISTRATION',
    ['D-ENTRY-W', 'D-UPPER-EXIT', 'D-UPPER-HALL'],
    ['S1', 'S3', 'S5', 'U2', 'U3'],
    '玄関中心X=0、下側直段X=[−.385,.385]、上側直段X=[−1.265,−.495] m。上側階段を−Zへ戻り、2階到着後に右（+X）へ曲がって中心Z=1.135 mの直線廊下でLDK入口へ',
    '原点は玄関枠室内端の中央と土間面。+Y上、+Z玄関から内側、+X内側を見た左',
    '玄関・階段の登録はv1を維持し、U3（2026-10-07利用者訂正）の階段到着後の右折を+Xへ配置する仮説。U2の左右に扉なしという前提を引き継ぐ。写真と図の左右一致・鏡像や実住宅との一致は認定しない。',
    ['entry', 'stairs', 'upper-hall', 'ldk'],
  ),
  assumption(
    'A-STAIR-PLAN',
    ['D-ST-W', 'D-TURN-W', 'D-TURN-D', 'D-TREAD-i'],
    ['S1', 'S2', 'S3', 'S5'],
    '直段内法.770 m×2、中央壁.110 m、全幅1.650 m。直踏面.230 m×5、折返し奥行.775 m',
    '壁内面と腰壁本体面。手すりは対象外',
    'S2の約.780 m/約1.600 m/約.750〜.800 mの概算と、S1の二列の直段と折返しの比率に対応する独立した整合セット。概算差から腰壁厚を逆算していない。',
    ['stairs'],
  ),
  assumption(
    'A-STAIR-LEVELS',
    ['D-STAIR-COUNT', 'D-FLOOR-RISE', 'D-RISER-i', 'D-WINDER-i'],
    ['S1', 'S3', 'S5'],
    '下側5直段＋6回り段＋上側5直段＋廊下への1蹴上げ。各.170 m、階高2.890 m',
    '階段前床Y=.160 m→2階廊下Y=3.050 m',
    '写真の複数直段と扇形の折返しを保持し、図の短い二列の階段に配置できる数値仮説。写真の全段数を数え切った値ではなく、階高も独立した実測ではない。',
    ['stairs', 'upper-hall'],
  ),
  assumption(
    'A-WINDERS',
    ['D-WINDER-i'],
    ['S1', 'S3'],
    '6枚の凸四角形。Z=2.670〜3.445 m、中央壁端Z=2.725 m。外周分割Z=3.058 m / 局所X=±.460 m',
    '各踏面の頂点と高さはstepLedgerに列挙',
    'S1/S3の複数の扇形踏面を6枚の高さが異なる領域として表す。角度等分を資料事実にせず、外壁・中央端の間を隙間なく分割する仮定。平坦な踊り場へ置換しない。',
    ['stairs'],
  ),
  assumption(
    'A-ENTRY',
    ['D-ENTRY-W', 'D-ENTRY-H', 'D-ENTRY-T', 'D-ENTRY-LEAF'],
    ['S1', 'S4', 'S5'],
    '有効幅.770 m、高さ2.040 m、枠奥行.145 m、敷居Y=.018 m。扉幅.800 m/厚.038 m/高さ2.040 m、外側90°固定',
    '左右枠X=±.385、枠Z=−.145〜0、上枠下端Y=2.058。蝶番X=.385,Z=−.145',
    'S4/S5の枠・金属敷居・S1の外開き記号を立体化するため、下側動線と同心の開口を採用。写真に開放角や基準寸法はなく、90°や開口値は個別の仮定。',
    ['entry'],
  ),
  assumption(
    'A-OUTSIDE',
    ['D-OUTSIDE'],
    ['S1', 'S5', 'U4'],
    'X=[−1.265,.385],Z=[−1.850,−.145] m、床Y=0。固定扉以外の追加障害物なし',
    '玄関枠外側端から外方向1.705 mの有限開始操作領域',
    '資料に外部全体は写っていない。開始箱全体を枠の外へ置くための有限矩形。2026-10-09の利用者指定で開始中心は枠外側面の1m手前とし、全箱の包含を独立に検証する。右折後の上階廊下はこの開始領域とXZで重ならない。実住宅の空地確認ではない。',
    ['entry'],
  ),
  assumption(
    'A-ENTRY-FLOORS',
    ['D-DOMA', 'D-KAMACHI', 'D-PRE-STAIR'],
    ['S1', 'S4', 'S5'],
    '土間X=[−1.265,.385],Z=[0,.900],Y=0 m。框/階段前床X=[−.385,.385],Z=[.900,1.520],Y=.160 m',
    '框前面Z=.900、最初の蹴上げZ=1.520',
    'S5の土間→框→水平床→直段の順序を保持。収納側は通過用床にせず、土間に比べ階段前の有効床を絞る。タイルの寸法換算はしていない。',
    ['entry', 'stairs'],
  ),
  assumption(
    'A-WAIST',
    ['D-WAIST-PLAN', 'D-WAIST-TOP', 'D-WAIST-CAP'],
    ['S3', 'S5'],
    '壁X=[−.495,−.385],Z=[1.520,2.725] m。上側各直段高＋.830 mの段状天端。笠木幅.150 m、厚.032 m、両側張出し.020 m',
    '中央壁端Z=2.725。回り段側最後の片は天端Y=3.030/笠木3.062 m',
    'S3の腰壁・笠木・勾配を有限高さの閉じた立体として保持する。凸多角柱契約に合わせた段状近似で、実際の滑らかな天端形状/高さとは未照合。',
    ['stairs'],
  ),
  assumption(
    'A-UPPER-HALL',
    ['D-UPPER-EXIT', 'D-UPPER-HALL'],
    ['U2', 'U3'],
    '到着床を含む廊下X=[−1.265,1.045],Z=[.750,1.520] m、幅.770 m、長さ2.310 m。床Y=3.050 m、床厚.170 m（下面Y=2.880 m）。左右は扉のない壁',
    '上側階段の最終辺Z=1.520から770 mm角の到着床へ進み、右（+X）へ曲がって中心Z=1.135のLDK廊下側枠X=1.045へ直進',
    'U3の到着後の右折を反映し、U2の廊下の左右に扉なしを維持。幅は上側階段、到着床を含む長さはv1廊下長を引き継いだ未実測値。下階床と上階床は別IDとし、新廊下を横断する下階の階段外側壁の人工延長を床下面で止める。',
    ['upper-hall'],
  ),
  assumption(
    'A-LDK',
    ['D-LDK-OPEN', 'D-LDK-LEAF'],
    ['S1', 'S2', 'U2', 'U3'],
    '有効幅.720 m、高さ2.005 m、枠奥行.120 m、敷居段差0。扉幅.720/厚.036/高さ1.975 m、床から下端.020 m、上端から枠下端.010 m、LDK側90°固定',
    '枠X=[1.045,1.165],Z=[.775,1.495],上枠下端Y=5.055。蝶番X=1.165,Z=1.495',
    'v1のLDK有効幅・高さ・枠奥行・扉寸法を保持し、U3の右折後の直線廊下終端へ向きを変えて配置。左右の扉なしという仮定は終端LDK扉の除去を意味しない。寸法と実配置は未確認。',
    ['ldk'],
  ),
  assumption(
    'A-CLOSED-DOORS',
    ['D-HALL-LEAVES', 'D-WALL-j'],
    ['S1', 'S5', 'U2', 'U3'],
    '玄関収納のみ閉鎖固定、葉厚.035 m/有効高2.000 m。2階収納・洗面室・トイレの扉は生成しない',
    '玄関収納の閉鎖葉と枠をphysicalSolidsへ登録。室内側の床/壁/器具は生成しない',
    '玄関収納はv1の条件を保持。2階はU2の左右に扉なしという仮定をU3の右折後も維持し、他室へ入る床や隣接辺は生成しない。実際の扉状態は未確認。',
    ['entry'],
  ),
  assumption(
    'A-SOLIDS',
    ['D-WALL-j', 'D-TREAD-i', 'D-WINDER-i'],
    ['S1', 'S3', 'S4', 'S5', 'U3'],
    '外壁厚.120 m、壁上端Y=14.250 m。地上/段立体底Y=−.220 m。2階廊下/枠床は厚.170 m、下面Y=2.880 mで最上段上面と接続。新廊下を横断する下階壁の上端はY=2.880 m',
    '内面を正本。通路側壁上端は人工外周Y=14 mを超え、乗越えを作らない。下階の階段外側壁X=[.385,.505]はZ=[.750,1.520]のみ床下面で止め、その上を2階床で閉じる。上階床と重ならなくなった玄関左枠は人工延長をY=14.250 mへ戻す',
    '天井の衝突形状は生成しない。壁は探索高さ全体を塞ぐ仮想延長を含む。階段は下面まで固体、上階床は有限厚の物理床とし、階下を地面まで埋めない。段鼻の突出は省略。',
    ['entry', 'stairs', 'upper-hall', 'ldk'],
  ),
  assumption(
    'A-LIMITS',
    [],
    ['P1'],
    '全床maxLift=.720 m、終端しろ.0015 m、人工bounds X=[−12.050,10.290],Y=[−.300,14.000],Z=[−10.035,3.685] m',
    '持上げは梱包最下点−各所属床高。境界では両床条件を同時適用',
    '搬送能力や実住宅天井高ではなく探索の仮想制約。v2の外周を狭めず、+X終端補助のためX上端だけ延長。回り段の複数の段差をまたぎつつ無制限浮上を防ぐ値。1.5 mmは演算境界用しろで測量誤差ではない。',
    ['entry', 'stairs', 'upper-hall', 'ldk'],
  ),
  assumption(
    'A-TERMINAL',
    [],
    ['U1', 'U2', 'U3', 'P1'],
    '仮想受け床X=[1.165,10.175],Z=[.775,1.495],基準Y=3.050 m、法線深さ9.010 m',
    'LDK側枠端を越える箱全体の判定まで。物理床なし、最終区間は姿勢と横位置固定の+X移動',
    '最大入力5.200 mのマージン箱対角未満9.007 mに通過しろを加えた有限補助。入力ごとの掃引部分に制限し、LDK内の旋回/移動/すき間へ流用しない。',
    ['ldk'],
  ),
];
