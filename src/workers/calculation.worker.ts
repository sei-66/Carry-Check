import { validateInputSnapshot } from '../domain/dimensions';
import {
  isCalculationOptions,
  isCalculationRequest,
  isInputSnapshot,
  isRecord,
  type CalculationFailureMessage,
  type CalculationMetadata,
  type CalculationWorkerMessage,
} from '../shared/calculation-messages';
import { FIXED_ROUTE } from '../shared/fixed-route';
import { createMaisonetteModel } from '../model/maisonette-model';
import { createModelQuery } from '../geometry/model-query';
import { runMaisonetteCalculation } from './run-maisonette-calculation';

let active = false;

function metadataFrom(value: unknown): CalculationMetadata {
  if (isRecord(value)) {
    const input = isInputSnapshot(value.input)
      ? value.input
      : {
          widthMm: Number.NaN,
          depthMm: Number.NaN,
          heightMm: Number.NaN,
          marginMm: Number.NaN,
        };
    return {
      requestId: typeof value.requestId === 'string' ? value.requestId : '',
      routeId: typeof value.routeId === 'string' ? value.routeId : '',
      direction: typeof value.direction === 'string' ? value.direction : '',
      modelVersion:
        typeof value.modelVersion === 'string' ? value.modelVersion : '',
      input,
    };
  }
  return {
    requestId: '',
    routeId: '',
    direction: '',
    modelVersion: '',
    input: {
      widthMm: Number.NaN,
      depthMm: Number.NaN,
      heightMm: Number.NaN,
      marginMm: Number.NaN,
    },
  };
}

function failure(
  metadata: CalculationMetadata,
  code: CalculationFailureMessage['code'],
  message: string,
): CalculationFailureMessage {
  return { type: 'failure', ...metadata, code, message };
}

function send(message: CalculationWorkerMessage): void {
  self.postMessage(message);
}

self.postMessage({ type: 'ready' });

self.onmessage = (event: MessageEvent<unknown>) => {
  const raw = event.data;
  const metadata = metadataFrom(raw);
  if (!isRecord(raw) || raw.type !== 'calculate') {
    send(failure(metadata, 'invalid-request', '要求の形式が不正です。'));
    return;
  }
  if (raw.modelVersion !== FIXED_ROUTE.modelVersion) {
    send(
      failure(
        metadata,
        'unsupported-model-version',
        '指定された経路契約には対応していません。',
      ),
    );
    return;
  }
  if (raw.routeId !== FIXED_ROUTE.id) {
    send(
      failure(
        metadata,
        'unsupported-route',
        '指定された経路には対応していません。',
      ),
    );
    return;
  }
  if (raw.direction !== FIXED_ROUTE.direction) {
    send(
      failure(
        metadata,
        'unsupported-direction',
        '指定された搬入方向には対応していません。',
      ),
    );
    return;
  }
  if (!isCalculationOptions(raw.options)) {
    send(failure(metadata, 'invalid-request', '計算上限が不正です。'));
    return;
  }
  if (!isInputSnapshot(raw.input)) {
    send(failure(metadata, 'invalid-request', '入力寸法の形式が不正です。'));
    return;
  }
  const validated = validateInputSnapshot(raw.input);
  if (!validated.ok) {
    send(failure(metadata, 'input-invalid', '入力寸法が範囲外です。'));
    return;
  }
  if (
    typeof raw.requestId !== 'string' ||
    raw.requestId.length === 0 ||
    raw.requestId.length > 128
  ) {
    send(failure(metadata, 'invalid-request', '要求IDが不正です。'));
    return;
  }
  if (!isCalculationRequest(raw)) {
    send(failure(metadata, 'invalid-request', '要求の形式が不正です。'));
    return;
  }

  if (active) {
    send(failure(metadata, 'invalid-request', 'このWorkerは計算中です。'));
    return;
  }
  active = true;
  void (async () => {
    let initialized = false;
    try {
      send({
        type: 'progress',
        ...metadata,
        stage: 'initializing',
        nodesVisited: 0,
        elapsedMs: 0,
      });
      const house = createMaisonetteModel();
      if (house.metadata.modelVersion !== FIXED_ROUTE.modelVersion)
        throw new Error('Model version mismatch');
      const query = await createModelQuery(house.geometry, validated.value);
      initialized = true;
      send({
        type: 'progress',
        ...metadata,
        stage: 'searching',
        nodesVisited: 0,
        elapsedMs: 0,
      });
      let previous = -Infinity;
      const result = runMaisonetteCalculation(
        query,
        house,
        raw.options,
        (nodesVisited, elapsedMs, stage) => {
          if (elapsedMs - previous >= 100 || stage === 'verifying') {
            previous = elapsedMs;
            send({
              type: 'progress',
              ...metadata,
              stage,
              nodesVisited,
              elapsedMs,
            });
          }
        },
        () => performance.now(),
      );
      send({ type: 'result', ...metadata, result });
    } catch (error) {
      send(
        failure(
          metadata,
          initialized ? 'calculation-error' : 'model-invalid',
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      active = false;
    }
  })();
};
