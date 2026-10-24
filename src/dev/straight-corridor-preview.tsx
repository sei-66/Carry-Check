import { useEffect, useRef, useState } from 'react';
import type {
  createRouteViewer,
  ViewPreset,
} from '../viewer/create-route-viewer';
import { STRAIGHT_CORRIDOR } from './straight-corridor';

export function StraightCorridorPreview() {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createRouteViewer> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<ViewPreset>('perspective');
  useEffect(() => {
    let active = true;
    let instance: ReturnType<typeof createRouteViewer> | undefined;
    const applyAppearance = () => {
      const { theme, design } = document.documentElement.dataset;
      instance?.setAppearance(
        theme === 'dark' ? 'dark' : 'light',
        design === 'pop' ? 'pop' : 'dot',
      );
    };
    const observer = new MutationObserver(applyAppearance);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-design'],
    });
    void import('../viewer/create-route-viewer')
      .then(({ createRouteViewer }) => {
        if (!active || !container.current) return;
        instance = createRouteViewer(
          container.current,
          () => {
            if (active) setStatus('error');
          },
          STRAIGHT_CORRIDOR,
        );
        viewer.current = instance;
        applyAppearance();
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('開発用廊下の3D表示に失敗しました', error);
        setStatus('error');
      });
    return () => {
      active = false;
      observer.disconnect();
      instance?.dispose();
      viewer.current = null;
    };
  }, [retry]);
  useEffect(() => {
    if (status === 'ready') viewer.current?.setView(view);
  }, [view, status]);
  return (
    <section
      className="dev-corridor-panel"
      aria-labelledby="dev-corridor-heading"
    >
      <div className="preview-heading">
        <div>
          <p className="eyebrow">DEVELOPMENT / DISPLAY ONLY</p>
          <h2 id="dev-corridor-heading">一直線の廊下</h2>
        </div>
        <span className="model-badge">開発画面専用</span>
      </div>
      <p className="dev-corridor-note">
        仮定寸法：有効幅 1,000 mm × 長さ 6,000 mm、壁高 2,400 mm、壁厚 100
        mm。天井・扉・段差はありません。見通しのため壁を半透明にしています。
      </p>
      <div className="viewer-stage">
        <div
          ref={container}
          id="dev-corridor-viewer"
          className="viewer-canvas"
          aria-label="開発用廊下の3D表示"
          aria-describedby="dev-corridor-help"
        />
        {status !== 'ready' && (
          <div className="viewer-message" role="status">
            <p>
              {status === 'loading'
                ? '廊下の3D表示を準備しています'
                : '廊下の3D表示を開始できませんでした'}
            </p>
            {status === 'error' && (
              <button
                type="button"
                className="interaction-button"
                onClick={() => {
                  setStatus('loading');
                  setRetry((value) => value + 1);
                }}
              >
                表示を再試行
              </button>
            )}
          </div>
        )}
      </div>
      <div className="viewer-tools">
        <div
          className="view-presets"
          role="group"
          aria-label="開発用廊下の視点"
        >
          {(
            [
              { id: 'perspective', label: '斜め' },
              { id: 'front', label: '正面' },
              { id: 'top', label: '上から' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              disabled={status !== 'ready'}
              onClick={() => {
                setView(id);
                viewer.current?.setView(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p id="dev-corridor-help" className="dev-corridor-note">
        ドラッグで回転、ホイール・ピンチで拡縮できます。ページのスクロールは3D表示の外で行えます。
        この廊下は表示検証用で、実住宅の寸法・計算対象ではありません。以下の通常画面のデザイン・テーマに連動します。
      </p>
    </section>
  );
}
