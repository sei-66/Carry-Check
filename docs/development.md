# 開発ガイド

[プロジェクト概要](../README.md) · [利用者向けの画面説明](product-guide.md) · [技術構成](architecture.md) · [動作確認・検証記録](verification.md)

## セットアップ

Node.js 24 系（24.14.1 以上）と npm 11 系を使用します。`.nvmrc` の基準バージョンは 24.14.1 です。Node.js のバージョン管理ツールは任意です。

`.npmrc` で `engines` に合わない環境の依存インストールを拒否します。バージョン不一致のエラーが出た場合は、Node.js と npm を上記の範囲に揃えてください。

すべてのコマンドはプロジェクトルートで実行します。

```sh
npm ci
npm run dev
```

`http://127.0.0.1:5173/` を開いてください。終了はターミナルで `Ctrl+C` を押します。ポート使用中の場合は `npm run dev -- --port 5174` のように変更できます。

Windowsでも通常は上記のnpmコマンドで起動します。`scripts/start-local.bat` はGit管理対象外の任意のローカル補助スクリプトで、新規cloneには含まれません。以下は手元のファイルを使う場合の操作です。

ローカルのbatをダブルクリックすると、起動場所にかかわらずbatのある `scripts/` の親フォルダー（プロジェクトルート）で実行し、Node.js/npmの存在を確認します。`node_modules/.bin/vite.cmd`がなければ`npm ci`で依存を復元するため、初回はインターネット接続が必要です。既存の依存を更新・同期するときは、別途`npm ci`を実行してください。

サーバーはローカル端末だけで接続できる`127.0.0.1`で起動し、既定ブラウザを自動で開きます。5173番ポートから開始し、使用中なら次の空きポートを使います。接続先は起動ウィンドウの`Local`欄を確認してください。確認中は起動ウィンドウを開いたままにし、終了は`Ctrl+C`で行います。終了確認が表示されたら`Y`を入力します。失敗時はエラーを表示してキー入力を待ちます。ルートのターミナルで`scripts\start-local.bat 5174`（PowerShellでは`.\scripts\start-local.bat 5174`）と実行すると開始ポートを指定できます。指定できる開始ポートは1〜65535の整数です。通常の`npm run dev`は引き続き指定ポートの使用中に失敗する設定です。

Windowsのcmdによる日本語行の誤解釈を避けるため、ローカルのbatはCP932・CRLFで保存し、実行時のコードページも932へ揃えます。Gitによる文字コード変換は行わないため、編集時もこの文字コード・改行を維持してください。他のソース・文書はUTF-8です。

開発サーバーの中断後、3Dの資材読み込み失敗が「3D表示を再試行」でも続く場合は、サーバーの起動を確認し、入力中の寸法を控えてからページを再読み込みしてください。復旧の確認範囲と未解明の原因は[検証資料](verification.md)を参照してください。

コミット時にテストとシークレット検査を自動実行するには、[uv](https://docs.astral.sh/uv/getting-started/installation/) をインストールし、次を実行します。`uv tool install` は開発環境で初回のみ、`pre-commit install` はリポジトリごとに実行します。hookが `config/pre-commit.yaml` を参照するよう、導入・再導入とも下の `install` コマンドを使ってください。uv は Python 製の pre-commit を管理し、アプリの依存管理には npm を使用します。

```sh
uv tool install pre-commit==4.6.2
uv tool run pre-commit install --config config/pre-commit.yaml
```

以後、`git commit` 時に gitleaks がステージ済みの変更を検査し、`npm test` が全件実行されます。どちらかが失敗するとコミットが中断されます。gitleaks の初回実行時には、pre-commit が Go と gitleaks を取得するためネットワーク接続が必要です。フックを手動で確認する場合は `uv tool run pre-commit run --config config/pre-commit.yaml --all-files` を実行してください。gitleaks はこの場合もステージ済みの変更を検査し、履歴全体の検査にはなりません。フックの実行には `npm ci` 済みの Node.js/npm 環境が必要です。CI は `npm run check` と Git 履歴の検査を実行します。

画面の確認項目とスマートフォンの接続手順は[動作確認](verification.md#動作確認)を参照してください。

## 開発コマンド

ESLint と Prettier は npm コマンドから設定パスを指定します。直接実行する場合は `npx eslint . --config config/eslint.config.js`、`npx prettier . --ignore-path .gitignore --ignore-path config/.prettierignore --check` のように指定してください。VS Code ではリポジトリをルートとして開くと、共有する `.vscode/settings.json` が ESLint と Prettier 拡張の参照先を指定します。他のエディタでは設定ファイル・除外ファイルの参照先を同じパスへ設定してください。Prettier のスタイル設定は `package.json` の `prettier` 項目で、引き続き自動検出できます。

| コマンド                       | 用途                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run dev`                  | 開発サーバー                                                   |
| `npm run typecheck`            | UI・Worker・設定/テストを分けて strict 型チェック              |
| `npm run lint`                 | 型情報付き ESLint                                              |
| `npm run format`               | Prettier で整形                                                |
| `npm run format:check`         | 整形差分を検出                                                 |
| `npm test`                     | Vitest を一度実行                                              |
| `npm run test:watch`           | Vitest の監視実行                                              |
| `npm run build`                | 型チェック後に `dist/` へ本番ビルド                            |
| `npm run preview`              | `http://127.0.0.1:4173/` でビルド成果物を確認                  |
| `npm run build:verification`   | 固定経路のWorker契約検証を `cache/verification-dist/` へビルド |
| `npm run preview:verification` | Worker契約の検証用成果物をプレビュー                           |
| `npm run build:performance`    | 製品と性能計測入口を `cache/performance-dist/` へまとめる      |
| `npm run preview:performance`  | 製品の読み込み・計算・描画を計測する本番プレビュー             |
| `npm run check`                | Lint・整形・テストランナー・型チェック・ビルドの一括確認       |

本番動作を確認するときは、`npm run build` → `npm run preview` の順に実行します。

テスト0件は失敗になります。[テストの方針](../tests/README.md)を参照してください。

## 構成と設定の判断

ブラウザ内で完結する静的アプリとして、Vite・React・TypeScript と module Worker を使用します。サーバーや SSR を前提にせず、重い判定と経路探索は Worker へ分離します。`src/main.tsx` は React の入口、`src/app/` は画面構成、`src/components/` は画面部品、`src/viewer/` は Three.js の表示、`src/workers/` は Worker の入口です。判定ロジックと通信型は DOM・描画処理から独立させ、Node 環境のテストで検証できるようにします。ファイルごとの責務は[技術構成](architecture.md)を参照してください。

React の `StrictMode` で副作用が再初期化されるため、Worker・Three.js・イベント購読は Effect で初期化し、cleanup で解放します。Tailwind CSS v4 は Vite プラグインと `src/style.css` の CSS・テーマ変数を入口とし、shadcn/ui は `components.json` に従って `src/components/ui/` にソースを生成します。`@/` は TypeScript・Vite・Vitest・shadcn/ui で同じ `src/` を指します。単一画面なのでルーターは導入していません。Pages のサブパス配信では資材の参照に Vite の import / URL 変換を使用します。

Vite・Vitest・TypeScript・ESLint と pre-commit の詳細設定は `config/` に置き、npm コマンドから明示的に参照します。ルートの `tsconfig.json` は `config/` の core・UI・Worker・Node の設定を束ねます。共通の strict 検査に加え、UI は DOM、Worker は WebWorker、core は ES、設定・テストは Node の型環境を使い分け、異なる実行環境の API を誤用しないようにしています。型情報付き ESLint は同じ TypeScript 設定を参照し、React Hooks と Fast Refresh の規則も適用します。整形は Prettier に任せ、スタイル設定は `package.json`、除外設定は `config/.prettierignore` に置きます。Git・Node.js・エディタの自動検出に必要な設定と `tsconfig.json` はルートに残します。

開発サーバーは既定で loopback の `127.0.0.1:5173` に固定し、指定ポートが使用中なら失敗します。`config/vite.config.ts` の `server.fs.deny` は Vite の既定値を置き換えるため、既定の拒否対象に加えて `references/`・`cache/`・ローカル設定・秘密情報の候補を明示しています。Vite を更新するときは拒否対象の既定値も照合してください。この制限は `public/` の静的配信とビルド時のコピーには適用されないため、住宅画像や秘密情報を `public/` に置かないでください。`.env` 類は Git から除外し、`VITE_*` には秘密情報を含めません。

通常の Vite ビルドでは既定のブラウザ対象を使い、legacy plugin や追加の polyfill は設けていません。構文変換はブラウザ API や WebGL 2 の対応保証ではないため、実機で別途確認します。描画用チャンクの容量警告は閾値を上げて隠さず、追加の分割は実機での読み込み時間・メモリの計測を根拠に判断します。Vitest は Node 環境で `tests/**/*.test.ts` を対象とし、DOM・Worker の実通信・3D 描画・タッチ操作はブラウザで確認します。CI の壁時計による速度閾値は正しさのテストに使わず、性能は後述の専用ビルドで同条件比較します。

## 計算基盤のブラウザ検証

仮定住宅の小箱（120×180×140mm、margin10）の全経路と、固定要求境界・20回中止/再生成を実Workerで確認する専用ページです。開発サーバーの`http://127.0.0.1:5173/tests/browser/calculation.html`で最後の`status: PASS`を確認します。範囲外・旧シナリオ・別経路・逆方向・異なる版を拒否します。実測住宅の搬入可否を確かめる検査ではありません。例や選択肢は設けず、ブラウザのエラーも確認します。

本番最適化とサブパスは次の順で確認します。

```sh
npm run build:verification
npm run preview:verification
```

`http://127.0.0.1:4173/tests/browser/calculation.html` を確認し、プレビューを停止してから次を実行します。

```sh
npm run build:verification -- --base=/Carry-Check/
npm run preview:verification -- --base=/Carry-Check/
```

`http://127.0.0.1:4173/Carry-Check/tests/browser/calculation.html` を確認します。検証成果物は `cache/verification-dist/` に限定し、製品の `dist/` やPagesへ公開しません。通常の製品ビルドは引き続き `npm run build` です。端末・ブラウザ版・応答コード・Worker生成/終了回数と未確認範囲は[検証記録](verification.md)へ記録します。

## 製品の性能計測

同じ計測ページの「家具・家電12サイズを計算」で、公開梱包寸法と仮定梱包寸法の12件を各1回、直列の新Workerで検査できます。`furnitureSizes`には結果・時間・失敗コードと、計算終了/経路確認/すき間評価の件数を別々に記録します。反復性能測定とは区別し、[寸法の出典・留保・結果](furniture-verification.md)を参照してください。

現在の製品・契約検証・性能計測は計算時間上限15秒、探索ノード上限5000を使います。2026-10-04の性能記録は変更前の10秒条件であり、15秒条件との比較では上限の違いを記録してください。

```sh
npm run build:performance
npm run preview:performance
```

`http://127.0.0.1:4173/tests/browser/performance.html`で「製品の読み込みを測定」、次に「計算・描画を測定」を操作します。製品のHTML/JS/CSSは通常ビルドのコピーをそのまま使用します。計算は同じ製品Worker・入力・seed・上限を使用し、小箱と縦長箱の初回と後続5回、予算上限ケース、静止1秒と3秒再生を記録します。各回新Workerで、資材キャッシュは制御しません。ページを非表示にすると描画結果が変わるため、`hidden`と`reducedMotion`も確認してください。

表示JSONを保存し、同じ端末・条件の変更前後を比較します。`renderCpuMs`はCPUの命令発行時間、fpsはRAF周期、geometry/textureはリソース数であり、GPU時間/保持メモリとは区別します。canvas準備観察時刻を実際の描画完了や冷間ロードとして扱いません。計測入口は製品`dist/`に含めず、`cache/performance-dist/`をPagesへ公開しません。サブパスの製品動作は通常のPages用ビルド手順で別途確認します。[性能計測の条件と記録](performance.md)を参照してください。

「画面外の3D読み込みを測定」は390×844の製品iframeでスクロール前後の資材要求とcanvas生成を比較します。「計算中の不要描画を測定」は実画面で600×800×1200mmの探索を開始し、静止canvasのWebGL2描画命令を2秒間数え、中止します。計測中だけ元のdraw関数をラップし、終了時に戻します。描画資材の総容量は延期で小さくなるわけではありません。実機・GPU測定とは区別し、[性能計測の条件と記録](performance.md)を参照してください。

## M1回り段Worker計測

開発サーバーの `http://127.0.0.1:5173/tests/browser/m1.html`、専用検証ビルドの `http://127.0.0.1:4173/tests/browser/m1.html` で固定の局所形状を自動実行します。前節と同じ `npm run build:verification` / `npm run preview:verification` を使います。サブパス用に `--base=/Carry-Check/` を付けた場合は `http://127.0.0.1:4173/Carry-Check/tests/browser/m1.html` です。旧3例や経路選択はありません。

初期化/計算/要求応答/Worker寿命、同Worker5回、新規エンジン5回、1500 ms初期化遅延と計算前保持中の中止/再試行、20回再生成を記録します。ページの「実行中止」はWorkerを終了し、「再実行」で最初から実行します。「JSONダウンロード」で記録を保存できます。キャッシュ無制御の新規Worker計測を完全な冷間ロードと扱いません。

4種類の短期限超過と新Workerの通常期限での再試行は`deadlineChecks`へ分離します。起動/初期化/計算100msと寿命1200msを使い、通常の20/30/15/70秒の設定は変えません。全検査で35生成/35終了、うち再生成検査は20回です。寿命検査は計算完了後のidle到達が必須で、低速端末で到達前に期限となった場合は失敗と記録します。性能の試料には短期限・遅延・保持の検査を含めません。

検査成功とM1採用合格は区別します。`precisionProbe` は微小すき間のRapier不一致、`distanceRefinementProbes` は角/辺対辺/薄い三角柱の固定解析ケースと診断失敗ID、`candidateFloorVerification` は既存探索候補の床適合を保持します。追加プローブは自動実行し、開発用の選択肢は設けません。住宅全体、LDK入口、製品の搬入可否は計算しません。[M1の範囲と制約](geometry-verification.md)を確認してください。製品の `dist/` へは含めず、専用成果物もPagesへ公開しません。

## デザインのブラウザ検証

`npm run dev` の起動後、`http://127.0.0.1:5173/tests/browser/design.html` で一直線の廊下の3D表示と、通常AppのStrictMode再マウントを確認できます。廊下の有効幅1,000mm、長さ6,000mm、壁高2,400mm、壁厚100mmは表示検証用の仮定値です。天井・扉・段差は設けず、搬入探索には接続しません。廊下の定義は `src/dev/straight-corridor.ts` に閉じ、通常App・Workerへ読み込みません。旧3例や再生用の架空経路はありません。

Appは製品と同じ仮定住宅・探索Workerを使用します。廊下は表示専用のままです。[デザインと3D表示](design.md)を参照してください。この補助画面は通常ビルド・計算基盤の検証ビルドへ含めません。

`http://127.0.0.1:5173/docs/design-comparison.html`はB/Dの選定とEの参考に使う静的比較資料です。最新の住宅モデル・経路探索・再生・デザイン切替は製品画面で確認します。

## UI コンポーネントの追加

Tailwind CSS v4 は `@tailwindcss/vite` と `src/style.css` の `@import` / テーマ変数で設定します。shadcn/ui の生成設定はルートの `components.json` です。固定バージョンの CLI を devDependency に導入しています。

```sh
npx --no-install shadcn add input
```

生成先は `src/components/ui/` です。生成された依存と `package-lock.json` の変更、React lint・strict 型チェック、`@/lib/utils` への `cn` import を確認してください。`npm run check` とブラウザ確認も実行します。CLI が追加したソースは管理下のコードとして扱います。

## 依存と環境の管理

依存追加・更新時は `npm install` を使用し、`package.json` と `package-lock.json` を一緒に更新します。通常の環境復元と CI では `npm ci` を使用します。

依存追加時は `.npmrc` の `save-exact` によりバージョンを完全固定します。更新提案は Dependabot で確認し、互換性と CI を確認して取り込みます。Node.js の基準を更新するときは `.nvmrc`、`package.json` の `engines`、本書の記述を揃えてください。

依存パッケージ、ビルド出力、テストカバレッジ、キャッシュは `.gitignore` で除外します。ロックファイルは Git で管理します。

監査記録、監査の生JSON・ログ・画面は `cache/` に保存します。このディレクトリはGit追跡対象外で、新規cloneには含まれず、製品の配信対象にも含めません。監査から得た現行の仕様・検証範囲・残課題は、それぞれの正本文書へ反映します。文書の命名と履歴の扱いは[ドキュメント管理のルール](../AGENTS.md#ドキュメント管理)に従います。

`.env` と `.env.*` は Git 管理対象外です。共有する変数名の例は、秘密を含めない `.env.example` に記載できます。ブラウザへ渡す `VITE_*` 環境変数には秘密情報を含めないでください。

Markdown は末尾2スペースによる改行を保持し、コードの整形は Prettier に統一します。

## 第三者ライセンス通知

[LICENSE.md](../LICENSE.md)は第三者ソフトウェアの通知で、CarryCheck独自コードの利用許諾は変更しません。Tailwind CSS、管理下のshadcn/ui由来ソース、Viteが挿入するブラウザ実行コードの全文通知を手動で管理します。これらを更新・変更した場合はパッケージの原本と照合してください。

本番ビルドでは `config/vite.config.ts` が次の2ファイルを出力先の直下に含めます。追加の通知生成コマンドは不要です。

- `LICENSE.md`: ルートの通知をそのまま同梱します。
- `THIRD_PARTY_LICENSES.md`: Viteの `build.license` がJavaScriptへ実際にバンドルした依存の名称・版・識別子・ライセンス全文から生成します。CSSや管理下ソースは自動収集されないため、前者で補います。LucideのFeather由来アイコンの通知など、ライセンスファイル内の複数の通知を省略しません。

依存追加・更新時は自動生成通知に本文があること、別の `NOTICE` やソースに取り込んだ資材の通知が必要でないかも確認します。Worker内へ外部依存を追加した場合も別に照合してください。現行の製品Workerは外部パッケージをバンドルせず、Rapierは配信しない診断専用ビルドに分離しています。`public/` へリポジトリ全体や住宅資料をコピーする方式は使いません。Pages用のビルド後は `/Carry-Check/LICENSE.md` と `/Carry-Check/THIRD_PARTY_LICENSES.md` のHTTP200と本文を確認し、両方を含む `dist/` を配信します。

## 開発依存の互換性と監査

依存の宣言値は `package.json`、解決済みの版は `package-lock.json` を正本とします。TypeScriptはtypescript-eslintのpeer範囲（6.1未満）に合わせて6.0.3、Node型は実行環境に合わせ24系を使用します。

`@vitejs/plugin-react` は Vite 8と互換な6.1.2を使用し、ロックファイルに基づく `npm ci` で依存を復元します。React Compilerは使用せず、未使用の任意peerは追加しません。依存更新時は `npm ci` と `npm run check` で互換性を確認し、peerの競合を `--force` や `--legacy-peer-deps` で回避しません。

`package.json` の `overrides.ip-address` は、開発依存の許容範囲内で[修正版10.7.4以降](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5)を選ぶ下限です。依存元が修正下限を採用したら、このoverrideを除去できるか確認します。

依存更新時と公開予定コミットで `npm audit` と `npm audit --omit=dev` を実行します。結果は日時とデータベースの状態に依存するため、過去の件数を現在の残件や安全性の保証として扱いません。通知された依存の到達条件と修正版を確認し、依存元の許容範囲内で解決します。確認済みの範囲は[検証資料](verification.md#開発環境と品質検査)、監査の詳細は非追跡の `cache/` に保存します。shadcnはローカルの部品生成に使用し、製品バンドルには含めません。古いshadcnへの降格やpeer制約の無効化を伴う強制更新は採用しません。

## CI と GitHub Pages

`.github/workflows/ci.yml` は `main` への push、pull request、手動実行に加え、毎週月曜07:23 JSTに検査します。定期実行は既存の依存・履歴を再検査するためのもので、配信しません。GitHub側の混雑で実行が遅れる場合があります。

| ジョブ      | 検査・処理                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`     | `.nvmrc` とロックファイルに基づく `npm ci`、開発依存を含む `npm audit --audit-level=high`、`npm run check`、リポジトリ名をbaseにしたPagesビルド、配信物の構成検査 |
| `workflows` | actionlint v1.7.12でワークフローの構文・式を検査。Ubuntu runnerのShellCheckでシェルも検査                                                                         |
| `secrets`   | 全ブランチ・タグの履歴を取得し、gitleaks v8.30.1で `--all HEAD` を検査                                                                                            |
| `deploy`    | 3検査の成功後、同じ実行の `check` が保存したPages成果物を配信。有効化条件は下記を参照                                                                             |

`npm audit` のhigh・criticalと監査自体の失敗はCIを止めます。low・moderateもログへ表示しますが、このしきい値ではCIを失敗させません。依存更新時と公開前には前節の全件監査も実施します。gitleaksとactionlintは版とダウンロードしたバイナリのSHA-256を固定し、gitleaksはダミートークンを検出できることも確かめます。これらのCLIはDependabotの更新対象ではないため、更新時に公式リリースとチェックサムを照合します。

配信物は `dist/index.html`、`dist/LICENSE.md`、`dist/THIRD_PARTY_LICENSES.md`、`dist/assets/` 配下のJS/CSSに限定し、その他のファイルやシンボリックリンクを検出したら失敗します。画像・フォントなどを追加する場合は、公開可能な内容であることを確認し、この許可範囲も同じ変更で更新してください。構成検査は、許可ファイル内の秘密情報や住宅資料まで検出する保証ではありません。成果物の保存は配信対象の実行だけで、保持期間は1日です。`secrets` と `workflows` は並行検査のため、それらが失敗しても保存済み成果物は残り得ますが、配信は行いません。

通常ジョブは `contents: read`、配信ジョブだけは `pages: write` と `id-token: write` を使用します。Actionの完全SHA固定、checkoutの `persist-credentials: false`、GitHub公式Actionだけを許可する運用を維持します。PRは `pull_request` で検査し、書き込み権限を付けてPRコードを動かす `pull_request_target` や別実行の成果物を受け取る配信は使いません。古いPRの検査は中断し、実行中のmainの検査・配信は中断しません。`github-pages` の配信も同時に1件に制限します。

`.github/dependabot.yml` は npm とGitHub Actionsの更新を週次で提案します。npmのminor / patchはまとめ、majorは個別に確認します。自動マージは設定していません。Three.jsのような0.x系はminor更新でも互換性を確認してください。

### 配信の有効化

リポジトリ変数 `PAGES_ENABLED` が文字列 `true` のときだけ配信できます。未設定または `false` では検査だけが動き、成果物のアップロードと配信ジョブはスキップします。有効化後は `main` へのpushで自動配信します。手動配信はActionsの `CI` → `Run workflow` でブランチ `main` を選び、`deploy_pages` を有効にします。既定の手動実行では検査だけを行います。PR・他ブランチ・定期実行からは配信しません。

このリポジトリ `sei-66/Carry-Check` は、非公開のままpushしてCIを確認した後、パブリックへ切り替えてPagesを有効にします。公開範囲・Actions・Pages・ブランチ保護の設定対象はこのリポジトリに限定します。GitHub側の準備は次の順で行います。

1. 設定を含むコミットをpushし、Actionsで `check`・`workflows`・`secrets` の成功を確認します。ローカル検査の成功だけではGitHub CIの成功と扱いません。
2. Settings → Actions → Generalで公式Actionのみ許可し、完全SHA固定を必須にします。Workflow permissionsは読み取り専用、ActionsによるPR作成・承認は無効にします。
3. 下記の公開前検査と[公開の受け入れ条件](verification.md#未確認事項と受け入れ条件)を確認し、Settings → General → Danger Zone → Change repository visibilityで、このリポジトリだけを **Public** に切り替えます。リポジトリの公開時点でGit履歴も閲覧可能になるため、秘密情報と住宅資料の確認は切替前に完了させます。
4. `main` にPR経由の変更、上記3ジョブの必須チェック、ブランチの最新化、force push・削除の禁止を設定します。個人開発で承認者を確保できない場合は、他人の承認を必須にしてマージ不能にしないでください。
5. Settings → PagesのSourceを **GitHub Actions** にし、Settings → Environmentsの `github-pages` を `main` だけに制限します。通常はブランチ名 `main` を許可し、タグは許可しません。必要に応じて承認者も設定します。成果物の保持は1日なので、それ以内に承認し、期限を超えたらmainで検査・配信を再実行します。
6. Settings → Secrets and variables → Actions → Variablesで `PAGES_ENABLED=true` を設定し、mainの手動配信を実行します。公開範囲や変数の変更はこのワークフローの実行契機に含まれないため、初回は `deploy_pages` を有効にした手動実行が必要です。配信後は実URLの画面・Worker・JS/CSS・ライセンス通知を確認します。以後はmainへのpushで自動配信します。

配信を止めるときは `PAGES_ENABLED=false` にし、実行中の配信があればActionsで中断します。変数の無効化だけでは配信済みサイトを削除しないため、取り下げる場合はSettings → PagesでUnpublishします。

### ローカル確認と公開前検査

現在のリポジトリ `sei-66/Carry-Check` の Pages 用パスをローカルで確認するには、以下を実行します。

```sh
npm run build -- --base=/Carry-Check/
npm run preview -- --base=/Carry-Check/
```

`http://127.0.0.1:4173/Carry-Check/`で固定経路と仮定の説明、寸法入力、実Workerの結果、住宅3Dと経路再生を確認します。リポジトリ名を変更した場合はbaseも変更します。通常パスへ戻す場合は`npm run build`で再ビルドします。

一通り完成するまではリポジトリを非公開のまま開発します。公開前に、公開予定のブランチ・タグを反映した状態で CI の `secrets` ジョブが成功したことを確認します。ローカルで再確認する場合は、[公式リリース](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)の gitleaks v8.30.1 を使い、以下を実行します。`--all` の対象は取得済みの Git 参照に限られるため、現在の `HEAD` も明示します。

```sh
git fetch --all --tags
gitleaks git --redact --log-opts="--all HEAD" .
```

検出があれば、該当する認証情報を失効・更新してから履歴の扱いを確認します。あわせて、追跡中のファイルと `dist/` の内容を確認し、秘密情報や公開できない住宅資料が含まれないことを確かめます。過去のコミットを配信へ戻す場合も、この配信ゲートを持つ現在のワークフローを使い、監査と全検査を通した変更をmainへ反映します。Pagesの配信対象は `dist/` のみです。設定の根拠は[公式Pages手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)と[Actionsのセキュリティ指針](https://docs.github.com/en/actions/reference/security/secure-use)を参照してください。

## 実行環境による制限

制限された実行環境で npm のキャッシュ書き込みが拒否される場合は、`npm ci --cache ./cache/npm` でプロジェクト内のキャッシュを使用できます。

Windows の実行制限により、Vite・Vitestの子プロセス生成が `spawn EPERM` で拒否されたり、一時ファイル参照が失敗したりする場合があります。実行環境の制限とアプリの失敗を区別し、必要な検証だけを適切な権限で再実行します。通常のローカル開発で管理者権限を必須とする構成ではありません。
