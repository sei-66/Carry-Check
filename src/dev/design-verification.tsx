import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../app/app';
import { StraightCorridorPreview } from './straight-corridor-preview';
import '../style.css';

export function DesignVerification() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <aside className="dev-verification-tools">
        <h1>デザインの開発検証</h1>
        <p>
          開発サーバー専用。一直線の廊下と、製品と同じ画面を StrictMode
          で表示します。
        </p>
        <div>
          <button type="button" onClick={() => setMounted(!mounted)}>
            {mounted ? '画面をアンマウント' : '画面をマウント'}
          </button>
        </div>
        <p>
          廊下は表示専用です。通常画面は仮定住宅モデルを表示し、実Workerで経路を探索します。
        </p>
      </aside>
      {mounted && (
        <>
          <StraightCorridorPreview />
          <App />
        </>
      )}
    </>
  );
}

const root = document.getElementById('design-verification');
if (!root) throw new Error('Missing verification root');
createRoot(root).render(
  <StrictMode>
    <DesignVerification />
  </StrictMode>,
);
