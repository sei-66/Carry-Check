import { ArrowRight, Box, Info, Square } from 'lucide-react';
import type { FormEvent } from 'react';
import type {
  DimensionField,
  DimensionValidationResult,
  RawDimensions,
} from '@/domain/dimensions';
import { Button } from './ui/button';
import { PackageDiagram } from './package-diagram';

const fields = [
  { id: 'widthMm', label: '幅', axis: 'W' },
  { id: 'depthMm', label: '奥行', axis: 'D' },
  { id: 'heightMm', label: '高さ', axis: 'H' },
] as const;

interface Props {
  readonly raw: RawDimensions;
  readonly validation: DimensionValidationResult;
  readonly touched: Readonly<Partial<Record<DimensionField, boolean>>>;
  readonly busy: boolean;
  readonly onChange: (field: DimensionField, value: string) => void;
  readonly onBlur: (field: DimensionField) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
}

export function DimensionsForm({
  raw,
  validation,
  touched,
  busy,
  onChange,
  onBlur,
  onSubmit,
  onCancel,
}: Props) {
  const errors = validation.ok ? {} : validation.errors;
  return (
    <section
      className="input-panel"
      id="dimensions-workspace"
      tabIndex={-1}
      aria-labelledby="input-heading"
    >
      <div className="panel-heading">
        <span className="step-number">01</span>
        <h2 id="input-heading">梱包サイズを入力</h2>
        <Box aria-hidden="true" size={19} />
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div className="package-figure">
          <PackageDiagram />
          <span>
            梱包材を含む
            <br />
            外寸
          </span>
        </div>
        <fieldset className="dimension-fields">
          <legend className="sr-only">
            梱包後のサイズ、単位はミリメートル
          </legend>
          {fields.map(({ id, label, axis }) => {
            const error = touched[id] ? errors[id] : undefined;
            return (
              <div className="dimension-field" key={id}>
                <label htmlFor={id}>
                  {label}
                  <span>{axis}</span>
                </label>
                <div className={`input-with-unit ${error ? 'has-error' : ''}`}>
                  <input
                    id={id}
                    name={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={raw[id]}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${id}-error` : 'dimension-help'}
                    onChange={(event) => onChange(id, event.target.value)}
                    onBlur={() => onBlur(id)}
                  />
                  <span>mm</span>
                </div>
                {error && (
                  <p id={`${id}-error`} className="field-error">
                    {error.replaceAll(' mm', '\u00a0mm')}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
        <p id="dimension-help" className="field-hint">
          それぞれ 1〜5,000&nbsp;mm で入力
        </p>
        <div className="margin-field">
          <div>
            <label className="field-label" htmlFor="marginMm">
              安全マージン
            </label>
            <p id="margin-help" className="field-hint">
              箱の各面に加える余裕（5〜100&nbsp;mm、初期値 10&nbsp;mm）
            </p>
          </div>
          <div
            className={`input-with-unit ${touched.marginMm && errors.marginMm ? 'has-error' : ''}`}
          >
            <input
              id="marginMm"
              name="marginMm"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={raw.marginMm}
              aria-invalid={!!(touched.marginMm && errors.marginMm)}
              aria-describedby={
                touched.marginMm && errors.marginMm
                  ? 'margin-error margin-help'
                  : 'margin-help'
              }
              onChange={(event) => onChange('marginMm', event.target.value)}
              onBlur={() => onBlur('marginMm')}
            />
            <span>mm</span>
          </div>
        </div>
        {touched.marginMm && errors.marginMm && (
          <p id="margin-error" className="field-error">
            {errors.marginMm.replaceAll(' mm', '\u00a0mm')}
          </p>
        )}
        <div className="margin-explanation">
          <Info size={15} aria-hidden="true" />
          <p>
            10&nbsp;mm を指定すると、幅・奥行・高さにそれぞれ 20&nbsp;mm{' '}
            <span className="phrase">加えた大きさとして扱います。</span>
          </p>
        </div>
        {busy ? (
          <Button
            className="calculate-button cancel-button"
            type="button"
            onClick={(event) => {
              // React may reuse this node as the submit button after cancellation.
              // Suppress the current click's default action before changing state.
              event.preventDefault();
              onCancel();
            }}
          >
            <Square size={16} aria-hidden="true" />
            計算を中止
          </Button>
        ) : (
          <Button className="calculate-button" type="submit">
            <span>経路を探す</span>
            <span className="calculate-symbol">
              <ArrowRight size={18} aria-hidden="true" />
            </span>
          </Button>
        )}
        <p className="calculation-caption">
          仮定住宅の中で、回転・傾斜を含む経路を探索します
        </p>
      </form>
      <div className="current-model">
        <div className="eyebrow">メゾネット賃貸の固定経路</div>
        <strong>玄関 →&nbsp;階段 →&nbsp;2階廊下 →&nbsp;LDK入口</strong>
        <p>
          一方向の搬入を対象にします。住宅寸法は仮定を含みます。
          <br />
          経路と動きの選択は不要です。
        </p>
      </div>
    </section>
  );
}
