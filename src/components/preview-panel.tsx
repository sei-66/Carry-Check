import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Box,
  Expand,
  Eye,
  Minus,
  Plus,
  Play,
  Pause,
  MapPin,
  RotateCcw,
} from 'lucide-react';
import type { ColorTheme, DesignTheme } from '@/shared/appearance';
import type {
  createRouteViewer,
  ViewerContent,
  ViewPreset,
  PlaybackState,
} from '@/viewer/create-route-viewer';
import { Button } from './ui/button';

interface Props {
  readonly content: ViewerContent;
  readonly theme: ColorTheme;
  readonly design: DesignTheme;
}

export const PreviewPanel = memo(function PreviewPanel({
  content,
  theme,
  design,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createRouteViewer> | null>(null);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [view, setView] = useState<ViewPreset>('perspective');
  const [playback, setPlayback] = useState<PlaybackState>({
    playing: false,
    progress: 0,
    atAttention: false,
  });
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const hasPath = !!content.path;
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    let active = true;
    let started = false;
    let instance: ReturnType<typeof createRouteViewer> | undefined;
    const host = container.current;
    if (!host) return;
    const initialize = () => {
      if (!active || started) return;
      started = true;
      observer?.disconnect();
      void import('@/viewer/create-route-viewer')
        .then(({ createRouteViewer }) => {
          if (!active || !container.current) return;
          instance = createRouteViewer(
            container.current,
            () => {
              if (active) setStatus('error');
            },
            undefined,
            (state) => {
              if (active) setPlayback(state);
            },
          );
          viewer.current = instance;
          setStatus('ready');
        })
        .catch((error: unknown) => {
          if (!active) return;
          console.error('3D表示の初期化に失敗しました', error);
          setStatus('error');
        });
    };
    // Small screens often start far above the viewer. Load and allocate WebGL
    // only near the viewport; keep this instance once it has been created.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) initialize();
      },
      { rootMargin: '160px' },
    );
    observer.observe(host);
    return () => {
      active = false;
      observer.disconnect();
      instance?.dispose();
      viewer.current = null;
    };
  }, [retry]);
  useEffect(() => {
    if (status === 'ready') viewer.current?.setContent(content);
  }, [content, status]);
  useEffect(() => {
    if (status === 'ready') viewer.current?.setAppearance(theme, design);
  }, [theme, design, status]);
  useEffect(() => {
    if (status === 'ready') viewer.current?.setView(view);
  }, [view, status]);
  function resetView() {
    setView('perspective');
    viewer.current?.setView('perspective');
  }
  return (
    <section className="preview-panel" aria-labelledby="preview-heading">
      <div className="preview-heading">
        <div>
          <p className="eyebrow">ROUTE / 3D VIEW</p>
          <h2 id="preview-heading">経路と、荷物の動き</h2>
        </div>
        <span className="model-badge">仮定住宅 · 実測0件</span>
      </div>
      <div className="viewer-stage">
        <div className="viewer-caption">
          <span className="viewer-scene-number" aria-hidden="true">
            3D
          </span>
          <div>
            <strong>玄関 →&nbsp;回り段 →&nbsp;2階で右折 →&nbsp;LDK入口</strong>
            {hasPath && <span>確認した経路を再生できます</span>}
          </div>
        </div>
        <div
          ref={container}
          id="viewer"
          className="viewer-canvas"
          aria-label="仮定住宅と梱包箱・確認した経路の3D表示"
          aria-describedby="controls-help"
        />
        {status === 'loading' && (
          <div className="viewer-message" role="status">
            <Box size={24} aria-hidden="true" />
            <p>3D表示を準備しています</p>
          </div>
        )}
        {status === 'error' && (
          <div className="viewer-message viewer-error" role="status">
            <Box size={26} aria-hidden="true" />
            <strong>3Dを表示できませんでした</strong>
            <p>
              計算結果とモデルの前提は本文で確認できます。WebGL&nbsp;2
              に対応した環境で再試行してください。
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setStatus('loading');
                setRetry((value) => value + 1);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              3D表示を再試行
            </Button>
          </div>
        )}
        {status === 'ready' && !content.dimensions && (
          <div className="viewer-input-prompt">
            <p>寸法を入力すると、荷物を重ねて表示します。</p>
          </div>
        )}
      </div>
      {hasPath && (
        <div className="playback-panel">
          <div className="playback-topline">
            <button
              type="button"
              className="playback-button"
              disabled={status !== 'ready' || reducedMotion}
              onClick={() => viewer.current?.setPlaying(!playback.playing)}
            >
              {playback.playing ? (
                <Pause size={16} aria-hidden="true" />
              ) : (
                <Play size={16} aria-hidden="true" />
              )}
              {playback.playing
                ? '再生を停止'
                : playback.progress >= 1
                  ? '初めから再生'
                  : '経路を再生'}
            </button>
            <output htmlFor="route-position">
              {Math.round(playback.progress * 100)}%
            </output>
          </div>
          <label className="sr-only" htmlFor="route-position">
            経路上の表示位置
          </label>
          <input
            id="route-position"
            type="range"
            min="0"
            max="1000"
            step="1"
            value={Math.round(playback.progress * 1000)}
            disabled={status !== 'ready'}
            aria-valuetext={`${Math.round(playback.progress * 100)}パーセント`}
            onChange={(event) =>
              viewer.current?.setPlaybackPosition(
                Number(event.target.value) / 1000,
              )
            }
          />
          <p>
            {reducedMotion
              ? '動きを減らす設定のため再生は停止しています。スライダーで姿勢を確認できます。'
              : 'スライダーで止めて姿勢を確認できます。再生速度は作業時間を表しません。'}
          </p>
          {content.path?.clearance && (
            <div className="attention-control">
              <button
                type="button"
                className="playback-button"
                disabled={status !== 'ready'}
                onClick={() => viewer.current?.showClearanceAttention()}
              >
                <MapPin size={16} aria-hidden="true" />
                <span>
                  すき間の
                  <wbr />
                  代表位置を見る
                </span>
              </button>
              <p>
                すき間評価で得た代表姿勢です。厳密な最小位置や現物の安全性を示すものではありません。
              </p>
            </div>
          )}
          <p className="attention-status" role="status" aria-live="polite">
            {playback.atAttention ? 'すき間の代表位置で停止しています。' : ''}
          </p>
        </div>
      )}
      <div className="viewer-tools">
        <div className="view-presets" role="group" aria-label="視点を選ぶ">
          {(
            [
              { id: 'perspective', label: '斜め', Icon: Box },
              { id: 'front', label: '正面', Icon: Eye },
              { id: 'top', label: '上から', Icon: ArrowDownToLine },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              disabled={status !== 'ready'}
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                viewer.current?.setView(id);
              }}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="zoom-controls">
          <button
            type="button"
            aria-label="縮小"
            disabled={status !== 'ready'}
            onClick={() => viewer.current?.zoom('out')}
          >
            <Minus size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="拡大"
            disabled={status !== 'ready'}
            onClick={() => viewer.current?.zoom('in')}
          >
            <Plus size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="視点をリセット"
            disabled={status !== 'ready'}
            onClick={resetView}
          >
            <Expand size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p id="controls-help" className="controls-help">
        ドラッグで回転、ホイール・ピンチで拡縮できます。ページのスクロールは3D表示の外で行えます。視点ボタンでも操作できます。
      </p>
      <div className="viewer-legend" aria-label="3D表示の凡例">
        <span>
          <i className="legend-box" />
          梱包箱
        </span>
        <span>
          <i className="legend-route" />
          確認した経路
        </span>
      </div>
    </section>
  );
});
