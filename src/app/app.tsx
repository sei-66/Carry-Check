import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ArrowDown, Box, Monitor, Ruler, ShieldCheck } from 'lucide-react';
import { DimensionsForm } from '@/components/dimensions-form';
import { PreviewPanel } from '@/components/preview-panel';
import { CalculationResult } from '@/components/calculation-result';
import { DotText } from '@/components/dot-text';
import {
  validateDimensions,
  type DimensionField,
  type RawDimensions,
} from '@/domain/dimensions';
import { useCalculation } from '@/hooks/use-calculation';
import {
  useAppearance,
  type DesignTheme,
  type ThemePreference,
} from '@/hooks/use-appearance';
import { sameInputSnapshot } from '@/shared/calculation-messages';

export function App() {
  const [raw, setRaw] = useState<RawDimensions>({
    widthMm: '',
    depthMm: '',
    heightMm: '',
    marginMm: '10',
  });
  const [touched, setTouched] = useState<
    Partial<Record<DimensionField, boolean>>
  >({});
  const [edited, setEdited] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const shouldFocusResult = useRef(false);
  const pendingInvalidField = useRef<string | undefined>(undefined);
  const calculation = useCalculation();
  const appearance = useAppearance();
  const validation = useMemo(() => validateDimensions(raw), [raw]);
  const foundMessage =
    calculation.state.status === 'result' &&
    calculation.state.message.result.status === 'path-found'
      ? calculation.state.message
      : null;
  const viewerContent = useMemo(
    () => ({
      dimensions: validation.ok ? validation.value : null,
      path:
        foundMessage &&
        foundMessage.result.status === 'path-found' &&
        validation.ok &&
        sameInputSnapshot(foundMessage.input, validation.value.snapshot)
          ? foundMessage.result
          : null,
    }),
    [validation, foundMessage],
  );
  useLayoutEffect(() => {
    if (pendingInvalidField.current) {
      document.getElementById(pendingInvalidField.current)?.focus();
      pendingInvalidField.current = undefined;
    }
  }, [touched]);
  useEffect(() => {
    if (
      shouldFocusResult.current &&
      ['result', 'failed', 'cancelled'].includes(calculation.state.status)
    ) {
      shouldFocusResult.current = false;
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({
        behavior: 'instant',
        block: 'nearest',
      });
    }
  }, [calculation.state.status]);
  function changeInput(field: DimensionField, value: string) {
    shouldFocusResult.current = false;
    calculation.invalidate();
    setRaw((previous) => ({ ...previous, [field]: value }));
    setEdited(true);
  }
  function calculate() {
    setTouched({
      widthMm: true,
      depthMm: true,
      heightMm: true,
      marginMm: true,
    });
    if (!validation.ok) {
      pendingInvalidField.current = Object.keys(validation.errors)[0];
      return;
    }
    shouldFocusResult.current = true;
    setEdited(false);
    calculation.calculate(validation.value.snapshot);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (calculation.busy) return;
    calculate();
  }
  return (
    <>
      <a className="skip-link" href="#dimensions-workspace">
        入力へスキップ
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href={import.meta.env.BASE_URL}
          aria-label="CarryCheck ホーム"
        >
          <span className="brand-mark">
            <Box size={23} strokeWidth={1.6} aria-hidden="true" />
          </span>
          {appearance.design === 'dot' ? (
            <DotText text="CARRYCHECK" decorative />
          ) : (
            <span>
              CARRY<span className="wordmark-light">CHECK</span>
            </span>
          )}
        </a>
        <div className="header-actions">
          <a href="#model-notes" className="model-notes-link">
            このモデルについて
            <ArrowDown size={13} aria-hidden="true" />
          </a>
          <label className="design-select">
            <span>デザイン</span>
            <select
              value={appearance.design}
              onChange={(event) =>
                appearance.setDesign(event.target.value as DesignTheme)
              }
            >
              <option value="pop">ポップ</option>
              <option value="dot">ソリッド</option>
            </select>
          </label>
          <label className="theme-select">
            <Monitor size={15} aria-hidden="true" />
            <span className="sr-only">表示テーマ</span>
            <select
              value={appearance.preference}
              onChange={(event) =>
                appearance.setPreference(event.target.value as ThemePreference)
              }
            >
              <option value="system">自動</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
        </div>
      </header>
      <main className="app-shell">
        <div className="workspace">
          <section className="intro">
            <div>
              <div className="intro-label">
                <span className="small-line" />
                {appearance.design === 'pop'
                  ? 'PACK IT. TURN IT. CHECK IT.'
                  : 'PACKED OBJECT / ROUTE STUDY'}
              </div>
              {appearance.design === 'pop' ? (
                <h1>
                  <span>向きを変えたら、</span>
                  <br />
                  どうだろう。
                </h1>
              ) : (
                <h1 aria-label="MOVE.IN">
                  <DotText text="MOVE.IN" decorative />
                </h1>
              )}
            </div>
            <div className="intro-description">
              <span className="development-badge">
                仮定住宅で検討 · 実測0件
              </span>
              <p>
                玄関から、回り段を通ってLDK入口へ。
                <br />
                梱包外寸と、各面の安全マージンを入力します。
              </p>
              <p className="intro-model-note">
                回転・傾斜を含む動きを探します。住宅寸法には仮定があり、実際の搬入を保証する計算ではありません。
              </p>
            </div>
          </section>
          <DimensionsForm
            raw={raw}
            validation={validation}
            touched={touched}
            busy={calculation.busy}
            onChange={changeInput}
            onBlur={(field) =>
              setTouched((previous) => ({ ...previous, [field]: true }))
            }
            onSubmit={submit}
            onCancel={calculation.cancel}
          />
          <div className="visual-column">
            <PreviewPanel
              content={viewerContent}
              theme={appearance.theme}
              design={appearance.design}
            />
            <div className="result-column">
              {edited && (
                <p className="input-changed-note" role="status">
                  寸法が変更されました。新しい条件で経路を探してください。
                </p>
              )}
              <CalculationResult
                state={calculation.state}
                elapsedMs={calculation.elapsedMs}
                resultRef={resultRef}
                onRetry={calculate}
                onCancel={calculation.cancel}
                onEdit={() => document.getElementById('widthMm')?.focus()}
              />
            </div>
          </div>
        </div>
        <section
          className="model-notes"
          id="model-notes"
          aria-labelledby="model-notes-heading"
        >
          <div className="notes-heading">
            <p className="eyebrow">BEFORE YOU CHECK</p>
            <h2 id="model-notes-heading">この画面で、確認できること。</h2>
            <p>図面・写真の特徴を、明示した仮定でつないだ住宅モデルです。</p>
          </div>
          <div className="notes-grid">
            <article>
              <Ruler size={22} strokeWidth={1.5} aria-hidden="true" />
              <h3>梱包外寸と、安全マージン</h3>
              <p>
                梱包した荷物を変形しない
                <span className="phrase">直方体</span>
                とし、各面に安全マージンを加えた箱の通過を調べます。床・蹴上げ・腰壁・笠木も含めます。
              </p>
            </article>
            <article>
              <Box size={22} strokeWidth={1.5} aria-hidden="true" />
              <h3>LDK入口を、箱全体が通るまで</h3>
              <p>
                階段を上がって2階で右折し、直線廊下を進んでLDK入口へ向かいます。必要な回転・傾斜を計算側で探索します。LDK内の移動・設置は評価しません。
              </p>
            </article>
            <article>
              <ShieldCheck size={22} strokeWidth={1.5} aria-hidden="true" />
              <h3>実寸と、現場の条件を確認</h3>
              <p>
                実測した住宅寸法は0件です。作業員の空間・養生・手すり・製品ごとの搬送姿勢などは対象外です。必要な寸法と搬送条件は現地で確認してください。
              </p>
            </article>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span className="footer-brand">CarryCheck</span>
      </footer>
    </>
  );
}
