# 技術構成

[プロジェクト概要](../README.md) · [製品ガイド](product-guide.md) · [計算仕様](calculation.md) · [開発ガイド](development.md) · [検証記録](verification.md)

## 採用技術

- UI: React + TypeScript（TSX）、Tailwind CSS v4、shadcn/ui（Radix UI ベース）
- 開発・ビルド: Vite
- 3D表示: Three.js
- 計算処理: Web Worker
- 公開先: [GitHub Pages](https://sei-66.github.io/Carry-Check/)。mainの全検査に成功した成果物を配信し、有効化変数で停止できる。[CIとPagesの手順](development.md#ci-と-github-pages)を参照
- 衝突・距離照会: 製品は独立f64の幾何区間。`@dimforge/rapier3d-compat` 0.21.0 はM1専用の比較診断、`three-mesh-bvh` 0.9.15 は比較用の開発依存
- 品質確認: TypeScript strict、ESLint、Prettier、Vitest

対象は一方向の「玄関 → 階段 → 2階廊下 → LDK入口」です。`model/maisonette-model.ts`が物理solid・床ID・portal・開口・候補guideを作り、`maisonette-assumptions.ts`が実測0件の採用仮定を保持します。LDK内部は作らず、仮想receiverへ姿勢を保った直進で枠を越える条件を使います。Workerが床ID付き姿勢候補を探索し、全辺を連続再検証した結果をReactへ返します。利用者は梱包外寸と安全マージンだけを指定します。3Dは同じsolidから生成し、内部を見せるため壁の一部を切り欠いて表示します。衝突判定は切欠き前の形状を使います。[住宅台帳](../references/housing-model-spec.md)と[計算仕様](calculation.md)に詳細を置きます。

固定契約の正本は`src/shared/fixed-route.ts`、モデル版は`maisonette-assumed-v3`です。階段を上がった後に右折し、その先の直線廊下でLDK入口へ進みます。床・壁・枠・扉・開口法線は計算と3Dで共用します。clientの`calculate(input, options)`がID・方向・版を固定し、Workerとclientの両方が入力・seed・上限・応答を検証します。起動20秒、エンジン初期化30秒、計算は要求時間+1秒（最大31秒）、Worker世代寿命70秒を管理します。進捗で期限を延長せず、応答受信時も絶対時刻を確認します。中止・入力変更・失敗・期限・完了でWorkerを終了し、次の要求で新しく生成します。旧シナリオと表示廊下は計算に接続しません。

`planner/maisonette-search.ts`は位置・回転・床IDを保持し、guideの候補列と姿勢候補を幾何問い合わせで検証します。開始中心は`model/entry-start.ts`の共有基準を使います。`floor-motion.ts`は積層床をXZだけで選ばず登録portalで移行し、物理衝突・マージン・持上げ・外周を連続証明します。探索と最終再検証は共通の予算を使います。

`planner/local-maisonette-maneuver.ts`は同じ床領域内で位置・持上げ・複合回転を探索する局所接続器です。壁位置と回転後の箱支持幅から候補を生成し、親探索の姿勢照会・辺検証・中止callbackを使います。参照経路の座標は製品に読み込みません。開発診断には候補数、接続数、辺の照会数と打切り内訳を返します。

`geometry/path-clearance.ts`は経路全体の梱包面と物理solid間の最小距離を区間として評価します。探索後の残予算で評価しきれないときは`clearance: null`を返します。物理距離と仮想制約を分離し、代表姿勢を厳密な最小位置とは扱いません。距離の証明方法、表示精度、受信ガードは[計算仕様](calculation.md)を参照してください。

TypeScript は typescript-eslint の対応範囲に合わせて 6.0 系を採用しています。UI の DOM、Worker の WebWorker、設定・テストの Node.js に加え、`tsconfig.core.json` で domain/model/geometry/planner/application/shared を DOM・Node の型なしで検査します。application の時計・タイマー・要求IDとWorker生成は注入し、ブラウザ側の接続は `src/hooks/create-calculation-worker.ts` に置きます。

ESLint は同じ TypeScript 設定を `projectService` で読み、未処理の Promise や不安全な型の利用を検査します。TypeScript は全実装ファイルを module として扱い、解決できない副作用 import も検査します。Vite の CSS 型宣言はワイルドカードのため、CSS ファイルの存在確認はビルドでも行います。

製品の`ModelQuery.query`と連続検証の照会は衝突証明用の保守的境界を使い、成立後のすき間評価は精密距離を使います。全掃引と持上げの区間境界で証明できなければ適応分割し、未確定や例外を通過扱いにしません。[選択理由と検証条件](calculation.md)を参照してください。

## 設定ファイルとフォルダ構成

Vite・Vitest・TypeScript の詳細設定と、ESLint・Prettier の除外・pre-commit の設定は `config/` に集約しています。ルートの `tsconfig.json` は各 TypeScript 設定への参照と alias を持つ入口です。npm コマンドは設定の場所を指定済みのため、プロジェクトルートで実行します。

Vite・Vitest を直接実行する場合や IDE 拡張から利用する場合は、それぞれ `config/vite.config.ts`・`config/vitest.config.ts` を設定ファイルに指定してください。

Prettier のスタイル設定は `package.json` の `prettier` 項目に統合し、エディタから自動検出できます。ESLint は `--config config/eslint.config.js`、Prettier の除外は `--ignore-path .gitignore --ignore-path config/.prettierignore`、pre-commit は `--config config/pre-commit.yaml` で場所を明示します。Prettier の明示指定は既定の除外ファイル一覧を置き換えるため、`.gitignore` も指定します。除外パターンは除外ファイルのあるディレクトリが基準です。現行パターンは名前で一致させる形式で、対象名に対応するファイルを除外します。

VS Code の ESLint・Prettier 拡張にも、`.vscode/settings.json` の `eslint.options.overrideConfigFile` と `prettier.ignorePath` で参照先を指定します。ESLint の作業ディレクトリはルートに固定し、TypeScript の `tsconfigRootDir` もルートを維持します。共有するのはこの設定ファイルだけで、個人の VS Code 設定は引き続き Git 管理対象外です。他のエディタの設定と、既存の pre-commit hook の再導入は[開発ガイド](development.md#セットアップ)を参照してください。

起動などの補助スクリプトは `scripts/` にまとめます。Windows用の `scripts/start-local.bat` はGit管理対象外の任意のローカルファイルで、新規cloneには含まれません。共有する起動手順は[開発ガイド](development.md#セットアップ)のnpmコマンドを使います。

ルートに残す12個のファイルの役割は次のとおりです。移動できないという制約ではなく、新しい clone での依存導入・Git の共通規則・IDE のプロジェクト検出などの入口を保つ方針です。たとえば TypeScript は CLI のパス指定で移動できますが、IDE と shadcn/ui の alias 解決に使う小さな入口は残しています。

| 分類                  | ルートのファイル                                        | 配置の理由                                                                   |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| npm・Node.js          | `package.json`、`package-lock.json`、`.npmrc`、`.nvmrc` | 依存管理・npm コマンド・Node.js バージョン管理と CI の入口                   |
| 型検査・UI 生成       | `tsconfig.json`、`components.json`                      | TypeScript・IDE と shadcn/ui が使う設定の入口。TypeScript の詳細は `config/` |
| Git・エディタ共通設定 | `.gitignore`、`.gitattributes`、`.editorconfig`         | リポジトリ全体の除外・文字コード・改行・編集規則を適用                       |
| アプリ・文書          | `index.html`、`README.md`、`AGENTS.md`                  | Vite の画面入口、リポジトリの案内、開発作業の指針                            |

| 場所                 | 用途                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `config/`            | Vite・Vitest・TypeScript・ESLint・Prettier除外・pre-commitの設定 |
| `scripts/`           | Windows のローカル起動などの補助スクリプト                       |
| `.vscode/`           | ESLint・Prettier の設定ファイル参照を共有                        |
| `src/main.tsx`       | React createRoot と StrictMode の入口                            |
| `src/app/`           | React の画面構成                                                 |
| `src/components/`    | Three.js 接続部品と共通 UI。`ui/` に shadcn/ui のソース          |
| `src/hooks/`         | 計算クライアントの購読・cleanup、テーマなどReactの副作用         |
| `src/lib/`           | `cn` などの共通ユーティリティ                                    |
| `src/style.css`      | Tailwind v4 の import とテーマ変数                               |
| `components.json`    | shadcn/ui のスタイル・生成先・alias                              |
| `src/viewer/`        | Three.js による描画と操作                                        |
| `src/workers/`       | Web Worker の実行入口                                            |
| `src/shared/`        | DOM に依存しない通信型・UIとviewerで共有する外観型               |
| `src/domain/`        | 寸法入力の検証・単位変換、XYZとquaternionの姿勢契約              |
| `src/model/`         | DOM非依存の凸多角柱・床・共有辺・人工制約の型と検証              |
| `src/geometry/`      | 物理距離区間、連続区間/経路の検証、M1用Rapier診断                |
| `src/planner/`       | DOM非依存の床ID付き住宅探索とNode回帰用RRT-Connect試作           |
| `src/application/`   | 単一ジョブ、要求の識別、中止・再生成・結果の無効化               |
| `src/dev/`           | 製品ビルドから分離したブラウザ検証入口・一直線廊下の表示fixture  |
| `tests/`             | DOM非依存テスト、テスト専用合成fixture、ブラウザ検証入口         |
| `docs/`              | 開発手順、設計・検証に関する文書                                 |
| `references/`        | 間取り・写真と、その読み取り結果                                 |
| `.github/workflows/` | CI（品質・依存・ワークフロー・履歴検査、Pagesビルドと配信）      |
| `cache/`             | ローカル作業用キャッシュ（Git 管理対象外）                       |

domainとplannerの長さはm、入力はmmです。Rapier診断内部だけ数値を1000倍します。安全証明は独立したf64の距離区間を使い、描画との共有契約もmのままです。計算ロジックはUIから独立しWorkerから呼び出します。合成形状は`tests/fixtures/`のNode回帰データで、画面の選択肢にはしません。

Rapierは閉じた凸形状の完全包含を衝突として扱うため、合成計算試作に選びました。BVHの表面交差と最近接点だけでは完全包含を見逃す比較結果があり、別途内外判定が必要です。製品判定に使わない診断が約4.39MBのWorker資材と各照会の追加処理を引き込むため、Rapier/WASMをM1専用の明示診断へ分離しました。製品の物理照会はWASMを初期化しません。`diagnosticsEnabled: false`の空配列を、診断で不一致がなかった結果とは扱いません。[性能記録](performance.md)を参照してください。

## M1の局所形状と精度

住宅用 `physical-query.ts` は、`prism-separation.ts` の独立したf64投影下限と頂点/辺の点対による上限を使います。有限線分の候補生成は `segment-distance.ts`、固定版Rapierの診断と取得済みWASM資源の解放は `rapier-diagnostic.ts` に分けました。`src/dev/fixtures/` の局所形状/距離プローブと専用M1 Workerは検証ビルドのみで使います。採用理由と数値誤差の限界は[計算仕様](calculation.md)、実行済み結果は[幾何検証](geometry-verification.md)を参照してください。

## React・Tailwind・shadcn/ui の責務

Vite は React と Tailwind の公式プラグインを読み込みます。Tailwind v4 は CSS を設定の入口とし、v3 の `tailwind.config.js` や PostCSS 設定は追加しません。`components.json` の Tailwind config は空にします。

`@/` は `src/` を指し、ルート tsconfig、app tsconfig、Vite、Vitest の alias を揃えます。TypeScript 6 に合わせて非推奨の `baseUrl` は使わず、設定ファイルからの相対 `paths` を指定します。UI は DOM と React の型を利用し、Worker と Node の型環境は分離したままです。

shadcn/ui の共通部品はソースを管理し、CarryCheckのテーマと見出しの意味に合わせて調整しています。生成物も通常の strict・lint・整形対象です。Reactの計算フックはEffectでapplicationクライアントを生成・購読し、cleanupで購読解除とdisposeを行います。ジョブ管理とタイムアウトの正本はapplicationです。入力変更で以前の通知を無効化し、起動確認のping/pongを製品計算には流用しません。

Three.jsは表示領域の160px近傍で初めて遅延importしEffectで生成・解放します。`PreviewPanel`は入力・成立結果・外観の変更に反応し、Worker進捗や時計だけの更新で3D内容を再送しません。`viewer/housing-scene.ts`が住宅solidを表示へ変換し、同じ不透明材質の静的形状だけを結合して描画命令を減らします。透明壁・扉・輪郭は個別の描画順を維持します。viewerは結果と同じ位置lerp/最短弧slerpで再生します。`setAppearance(theme, design)`は材質だけを更新し視点・再生位置を保持します。入力変更で以前の経路を消します。開発廊下は表示専用でWorkerへ接続しません。静止時は連続描画を避け、再生・操作・リサイズ・内容変更時に描画します。動き低減の変更で再生を停止します。[性能記録](performance.md)を参照してください。

外観は`src/style.css`の色・文字・余白・フォーカス・動きの定義に集約します。デザイン`pop`/`dot`と表示テーマ`system`/`light`/`dark`は独立して選択・保存します。`use-appearance.ts`が`carrycheck-design`/`carrycheck-theme`の読書きとOS追従を担当し、`src/shared/appearance.ts`の型をUIとviewerで共有します。ライト/ダークはOS設定と明示的な選択に対応し、`prefers-reduced-motion`で装飾遷移を抑えます。設計理由と残る品質ゲートは[デザイン仕様](design.md)を参照してください。

確認した経路は常に描画し、3Dの安全マージン枠は生成しません。表示レイヤーを切り替えるUI・状態・APIは持たず、安全マージンは入力と計算上のクリアランスに適用します。

単一画面のためルーターは導入していません。将来ルーティングする場合は GitHub Pages の直接アクセスを考慮してください。

## 住宅資料の扱い

間取り・写真はローカルの `references/floorplan/` と `references/photos/` に置き、Git 管理対象外とします。そのため、Git から取得した環境には参照画像が含まれません。[住宅モデル仕様・寸法台帳](../references/housing-model-spec.md)には、資料から読める形状と概算値、計算用の採用仮定、未確認事項を区別して記載します。

開発サーバーは環境ファイルなどの既定の拒否対象に加え、`references/`、`cache/`、ローカル設定を配信しません。`public/` に置いたファイルはこの制限の対象外で、本番出力にもコピーされるため、住宅資料や秘密情報は置かないでください。

## 関連仕様と記録

- [計算仕様](calculation.md): 住宅判定、数値幾何、探索、経路すき間、通信の契約
- [デザイン仕様](design.md): 画面と3Dの表現・操作・残る受け入れ条件
- [住宅モデル仕様・寸法台帳](../references/housing-model-spec.md): 住宅の座標、出典、採用仮定と未確認事項
- [検証記録](verification.md): 実行済みの検証、対象条件と未確認事項
- [AGENTS.md](../AGENTS.md): 実装・検証時の指示、基本コマンド、Git ワークフロー
