import {
  ArrowRight,
  Check,
  Clock3,
  CircleHelp,
  LoaderCircle,
  RotateCcw,
  Ruler,
  Square,
  TriangleAlert,
} from 'lucide-react';
import type { Ref } from 'react';
import type { CalculationState } from '@/application/calculation-client';
import type { PathNotFoundResult } from '@/shared/calculation-messages';
import { Button } from './ui/button';
import { createMaisonetteModel } from '@/model/maisonette-model';

const physicalLabels = new Map(
  createMaisonetteModel().elements.map((element) => [
    element.id,
    element.kind === 'floor'
      ? element.label.startsWith('step-')
        ? `階段${Number(element.label.slice(5))}段目の踏面・蹴上げ`
        : element.label.includes('doma')
          ? '玄関の土間'
          : element.label === 'pre-stair'
            ? '框と階段前の床'
            : element.label.includes('upper-hall')
              ? '2階廊下の床'
              : element.label.includes('threshold')
                ? '開口の敷居'
                : '玄関外の床'
      : element.label,
  ]),
);
function clearanceRange(lowerM: number, upperM: number): string {
  // Round the displayed interval outward, never narrowing a proven interval.
  const lower = Math.floor(lowerM * 10000) / 10;
  const upper = Math.ceil(upperM * 10000) / 10;
  return `${lower.toFixed(1)}〜${upper.toFixed(1)}`;
}

const reasons: Record<PathNotFoundResult['reason'], string> = {
  'start-invalid':
    '今回の開始候補では、玄関外に箱と安全マージンを収めた姿勢を確認できませんでした。',
  'goal-invalid':
    '今回の終端候補では、箱全体がLDK入口を通過する姿勢を確認できませんでした。',
  'node-limit':
    '探索回数の上限に達しました。この条件内で、確認できる経路を得られませんでした。',
  'time-limit':
    '探索時間の上限に達しました。この時間内で、確認できる経路を得られませんでした。',
  'verification-limit':
    '今回の探索条件では、連続した移動の安全性を確認できませんでした。',
  'no-path': '今回の探索条件内では、確認できる経路を得られませんでした。',
};

export function CalculationResult({
  state,
  elapsedMs,
  resultRef,
  onRetry,
  onCancel,
  onEdit,
}: {
  readonly state: CalculationState;
  readonly elapsedMs: number;
  readonly resultRef: Ref<HTMLElement>;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
  readonly onEdit: () => void;
}) {
  const busy = state.status === 'initializing' || state.status === 'running';
  const result = state.status === 'result' ? state.message.result : null;
  const found = result?.status === 'path-found';
  const unavailable =
    state.status === 'failed' && state.code === 'model-unavailable';
  const issue =
    (state.status === 'failed' && !unavailable) ||
    result?.status === 'path-not-found';
  const stage =
    busy && state.stage === 'verifying'
      ? '移動を再検証しています'
      : busy && state.stage === 'searching'
        ? '経路を探しています'
        : '計算を準備しています';
  const title = busy
    ? stage
    : found
      ? '仮定モデル上の経路を確認'
      : result
        ? '探索条件内では経路未発見'
        : state.status === 'cancelled'
          ? '計算を中止しました'
          : state.status === 'failed'
            ? unavailable
              ? '住宅モデルを利用できませんでした'
              : [
                    'input-invalid',
                    'model-invalid',
                    'unsupported-model-version',
                    'unsupported-route',
                    'unsupported-direction',
                    'invalid-request',
                  ].includes(state.code)
                ? '入力・モデルを確認してください'
                : '計算を完了できませんでした'
            : '寸法を入れて、経路を探す';
  const titleBreak = title.indexOf('できませんでした');
  return (
    <>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {title}
        {result?.status === 'path-found'
          ? result.clearance === null
            ? '。最小すき間の評価は未完了です。'
            : `。梱包箱の最小すき間は${clearanceRange(result.clearance.lowerBoundM, result.clearance.upperBoundM)}ミリメートルの区間です。`
          : ''}
      </p>
      <section
        id="calculation-result"
        ref={resultRef}
        tabIndex={-1}
        className={`result-panel ${found ? 'result-found' : ''} ${issue ? 'result-issue' : ''}`}
        aria-labelledby="result-heading"
        aria-busy={busy}
      >
        <div className="result-top">
          <span
            className={`result-icon ${busy ? 'is-loading' : ''}`}
            aria-hidden="true"
          >
            {busy ? (
              <LoaderCircle size={22} />
            ) : found ? (
              <Check size={23} />
            ) : issue ? (
              <TriangleAlert size={21} />
            ) : unavailable || state.status === 'idle' ? (
              <Clock3 size={22} />
            ) : state.status === 'cancelled' ? (
              <Square size={18} />
            ) : (
              <ArrowRight size={21} />
            )}
          </span>
          <div>
            <p className="eyebrow">02 計算結果</p>
            <h2 id="result-heading">
              {titleBreak < 0 ? (
                title
              ) : (
                <>
                  {title.slice(0, titleBreak)}
                  <wbr />
                  {title.slice(titleBreak)}
                </>
              )}
            </h2>
          </div>
          {busy && (
            <span className="elapsed-time">
              {(elapsedMs / 1000).toFixed(1)}
              <small>秒経過</small>
            </span>
          )}
        </div>
        {state.status === 'idle' && (
          <p className="result-description">
            梱包外寸と安全マージンを入力すると、玄関からLDK入口までの動きを探します。
            <br />
            モデルの概要は
            <span className="phrase">「このモデルについて」</span>
            で確認できます。
          </p>
        )}
        {busy && (
          <div className="result-description">
            <p>
              回転・傾斜を含む候補を探し、連続した移動を確認します。寸法を編集すると計算を中止します。
            </p>
            <Button
              variant="outline"
              className="result-action"
              onClick={onCancel}
            >
              <Square size={15} aria-hidden="true" />
              計算を中止
            </Button>
          </div>
        )}
        {state.status === 'cancelled' && (
          <div className="result-description">
            <p>
              入力した寸法は保持しています。もう一度、同じ条件で経路を探せます。
            </p>
            <Button
              variant="outline"
              className="result-action"
              onClick={onRetry}
            >
              <RotateCcw size={16} aria-hidden="true" />
              同じ条件で再試行
            </Button>
          </div>
        )}
        {state.status === 'failed' && unavailable && (
          <div className="result-description">
            <p>{state.message}</p>
            <p>
              入力した寸法は保持しています。ページを読み込み直してモデルを再取得してください。この計算の経路は未確認です。
            </p>
            <Button
              variant="outline"
              className="result-action"
              onClick={onEdit}
            >
              <Ruler size={16} aria-hidden="true" />
              寸法を見直す
            </Button>
          </div>
        )}
        {state.status === 'failed' && !unavailable && (
          <div className="result-description">
            <p>{state.message}</p>
            <p>
              入力は保持しています。再試行しても解消しない場合は、ページを読み込み直してください。
            </p>
            <Button
              variant="outline"
              className="result-action"
              onClick={onRetry}
            >
              <RotateCcw size={16} aria-hidden="true" />
              計算を再試行
            </Button>
          </div>
        )}
        {result?.status === 'path-not-found' && (
          <div className="result-description">
            <p>{reasons[result.reason]}</p>
            <strong className="non-conclusive">
              実際の搬入が不可能という意味ではありません。
            </strong>
            <Button
              variant="outline"
              className="result-action"
              onClick={onEdit}
            >
              <Ruler size={16} aria-hidden="true" />
              寸法を見直す
            </Button>
          </div>
        )}
        {found && (
          <>
            <p className="result-description">
              この仮定モデルと入力条件で、玄関外からLDK入口を箱全体が越えるまでの連続した移動を確認しました。LDK内の移動・設置は評価していません。
            </p>
            <div className="result-metrics">
              <div>
                <span>計算時間</span>
                <strong>
                  {(result.elapsedMs / 1000).toFixed(2)}
                  <small>秒</small>
                </strong>
              </div>
              <div>
                <span>梱包箱の最小すき間</span>
                <strong>
                  {result.clearance === null
                    ? '評価未完了'
                    : clearanceRange(
                        result.clearance.lowerBoundM,
                        result.clearance.upperBoundM,
                      )}
                  {result.clearance !== null && <small>mm</small>}
                </strong>
              </div>
            </div>
            <p className="clearance-note">
              <CircleHelp size={15} aria-hidden="true" />
              <span>
                {result.clearance === null
                  ? '経路全体のすき間評価は計算上限内に完了しませんでした。未評価を0\u00a0mmや安全とは扱いません。'
                  : '梱包箱表面から、床・段・枠・壁などの物理形状までの経路全体の距離区間です。人工境界や持上げ制約を除き、住宅寸法の誤差は含みません。'}{' '}
                {result.clearance === null
                  ? 'すき間の代表位置も未評価です。'
                  : '3Dの「すき間の代表位置を見る」で、評価に使った代表姿勢を確認できます。厳密な最小位置の特定ではありません。'}
              </span>
            </p>
            {result.clearance && (
              <p className="clearance-note">
                {result.clearance.attention.obstacleId &&
                physicalLabels.has(result.clearance.attention.obstacleId)
                  ? `代表位置の近接形状：${physicalLabels.get(result.clearance.attention.obstacleId) ?? ''}`
                  : '近接形状の特定は未完了'}
              </p>
            )}
            {result.clearance?.obstacleId && (
              <p className="clearance-note">
                最寄り形状：
                {physicalLabels.get(result.clearance.obstacleId) ??
                  'モデル内の物理形状'}
              </p>
            )}
          </>
        )}
        {state.status !== 'idle' && (
          <p className="result-boundary">
            {unavailable
              ? '搬入可否は未判定です。入力確認や箱の表示は、通過できることを示しません。'
              : '計算結果は、実際の搬入可否を保証するものではありません。'}
          </p>
        )}
      </section>
    </>
  );
}
