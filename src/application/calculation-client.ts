import {
  validateInputSnapshot,
  type InputSnapshot,
} from '../domain/dimensions';
import {
  isRecord,
  isInputSnapshot,
  sameInputSnapshot,
  type CalculationFailureCode,
  type CalculationOptions,
  type CalculationRequest,
  type CalculationWorkerMessage,
  type CalculationResultMessage,
  MAX_CALCULATION_SEED,
  MAX_CALCULATION_NODES,
  MIN_CALCULATION_NODES,
  MAX_CALCULATION_TIME_MS,
} from '../shared/calculation-messages';
import { FIXED_ROUTE_METADATA } from '../shared/fixed-route';
import { createMaisonetteModel } from '../model/maisonette-model';
import {
  isPose,
  interpolatePose,
  distance,
  rotationAngle,
  type Pose,
} from '../domain/pose';

export interface WorkerPort {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface CalculationRuntime {
  readonly setTimer: (callback: () => void, delayMs: number) => () => void;
  readonly createRequestId: () => string;
  readonly now: () => number;
}

export interface CalculationClientOptions {
  readonly createWorker: () => WorkerPort;
  readonly runtime: CalculationRuntime;
  readonly initializationTimeoutMs?: number;
  readonly calculationTimeoutMs?: number;
  readonly engineInitializationTimeoutMs?: number;
  readonly workerLifetimeMs?: number;
}

export type CalculationState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'initializing' | 'running';
      readonly request: CalculationRequest;
      readonly stage?: 'initializing' | 'searching' | 'verifying';
      readonly nodesVisited?: number;
      readonly elapsedMs?: number;
    }
  | {
      readonly status: 'result';
      readonly message: CalculationResultMessage;
    }
  | {
      readonly status: 'failed';
      readonly request: CalculationRequest;
      readonly code:
        | CalculationFailureCode
        | 'initialization-timeout'
        | 'calculation-timeout'
        | 'engine-initialization-timeout'
        | 'worker-lifetime-timeout'
        | 'worker-error'
        | 'invalid-response';
      readonly message: string;
    }
  | { readonly status: 'cancelled'; readonly request: CalculationRequest };

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

let modelIdentifiers:
  | {
      readonly floor: Set<string>;
      readonly physical: Set<string>;
      readonly starts: Set<string>;
      readonly goal: string;
    }
  | undefined;

function isKnownModelId(value: unknown, kind: 'floor' | 'physical'): boolean {
  if (typeof value !== 'string') return false;
  if (!modelIdentifiers) {
    const model = createMaisonetteModel();
    modelIdentifiers = {
      floor: new Set(model.geometry.floorRegions.map((region) => region.id)),
      physical: new Set(model.geometry.physicalSolids.map((solid) => solid.id)),
      starts: new Set(model.startRegionIds),
      goal: model.goalRegionId,
    };
  }
  return modelIdentifiers[kind].has(value);
}

function isClearanceAttention(poses: readonly Pose[], value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.segmentIndex) ||
    (value.segmentIndex as number) < 0 ||
    (value.segmentIndex as number) >= poses.length - 1 ||
    !isFiniteNonNegative(value.fraction) ||
    value.fraction > 1 ||
    !isPose(value.pose) ||
    !(value.obstacleId === null || isKnownModelId(value.obstacleId, 'physical'))
  )
    return false;
  const first = poses[value.segmentIndex as number],
    last = poses[(value.segmentIndex as number) + 1];
  if (!first || !last) return false;
  const expected = interpolatePose(first, last, value.fraction);
  return (
    distance(expected.position, value.pose.position) < 1e-8 &&
    rotationAngle(expected.rotation, value.pose.rotation) < 1e-8
  );
}

function isCalculationResultMessage(
  value: unknown,
): value is CalculationResultMessage {
  if (
    !isRecord(value) ||
    value.type !== 'result' ||
    !isInputSnapshot(value.input)
  )
    return false;
  if (
    typeof value.requestId !== 'string' ||
    typeof value.routeId !== 'string' ||
    typeof value.direction !== 'string' ||
    typeof value.modelVersion !== 'string' ||
    !isRecord(value.result)
  )
    return false;
  const result = value.result;
  if (
    !Number.isSafeInteger(result.seed) ||
    (result.seed as number) < 0 ||
    (result.seed as number) > MAX_CALCULATION_SEED ||
    !Number.isSafeInteger(result.nodesVisited) ||
    (result.nodesVisited as number) < 0 ||
    !isFiniteNonNegative(result.elapsedMs)
  )
    return false;
  if (result.status === 'path-not-found') {
    return [
      'node-limit',
      'time-limit',
      'no-path',
      'start-invalid',
      'goal-invalid',
      'verification-limit',
    ].includes(String(result.reason));
  }
  if (
    result.status !== 'path-found' ||
    !Array.isArray(result.poses) ||
    result.poses.length < MIN_CALCULATION_NODES ||
    result.poses.length > MAX_CALCULATION_NODES
  )
    return false;
  if (
    !result.poses.every(isPose) ||
    !Array.isArray(result.floorRegionIds) ||
    result.floorRegionIds.length !== result.poses.length ||
    !result.floorRegionIds.every((id) => isKnownModelId(id, 'floor'))
  )
    return false;
  // Intermediate portal crossings belong to the Worker's continuous geometry
  // proof; one edge may pass through more than one registered floor region.
  if (
    !modelIdentifiers?.starts.has(result.floorRegionIds[0] as string) ||
    result.floorRegionIds.at(-1) !== modelIdentifiers.goal
  )
    return false;
  if (result.clearance === null) return true;
  return (
    isRecord(result.clearance) &&
    isFiniteNonNegative(result.clearance.lowerBoundM) &&
    isFiniteNonNegative(result.clearance.upperBoundM) &&
    result.clearance.lowerBoundM <= result.clearance.upperBoundM &&
    result.clearance.upperBoundM - result.clearance.lowerBoundM <=
      0.001 + 1e-12 &&
    isClearanceAttention(result.poses, result.clearance.attention) &&
    (result.clearance.obstacleId === null ||
      isKnownModelId(result.clearance.obstacleId, 'physical'))
  );
}

function isCalculationResponse(
  value: unknown,
): value is Exclude<CalculationWorkerMessage, { type: 'ready' }> {
  if (!isRecord(value) || !isInputSnapshot(value.input)) return false;
  if (
    typeof value.requestId !== 'string' ||
    typeof value.routeId !== 'string' ||
    typeof value.direction !== 'string' ||
    typeof value.modelVersion !== 'string'
  )
    return false;
  if (value.type === 'progress') {
    return (
      (value.stage === 'initializing' ||
        value.stage === 'searching' ||
        value.stage === 'verifying') &&
      Number.isSafeInteger(value.nodesVisited) &&
      (value.nodesVisited as number) >= 0 &&
      isFiniteNonNegative(value.elapsedMs)
    );
  }
  if (value.type === 'result') return isCalculationResultMessage(value);
  if (value.type === 'failure') {
    return (
      [
        'input-invalid',
        'model-invalid',
        'model-unavailable',
        'unsupported-route',
        'unsupported-direction',
        'unsupported-model-version',
        'invalid-request',
        'calculation-error',
      ].includes(String(value.code)) &&
      typeof value.message === 'string' &&
      value.message.length > 0
    );
  }
  return false;
}

function snapshotsMatch(left: InputSnapshot, right: InputSnapshot): boolean {
  return isInputSnapshot(left) && sameInputSnapshot(left, right);
}

export class CalculationClient {
  private readonly createWorker: () => WorkerPort;
  private readonly runtime: CalculationRuntime;
  private readonly initializationTimeoutMs: number;
  private readonly calculationTimeoutMs: number;
  private readonly engineInitializationTimeoutMs: number;
  private readonly workerLifetimeMs: number;
  private phase: 'boot' | 'engine' | 'compute' = 'boot';
  private deadlineAt = Infinity;
  private lifetimeAt = Infinity;
  private cancelLifetimeTimer: (() => void) | undefined;
  private worker: WorkerPort | undefined;
  private cancelInitializationTimer: (() => void) | undefined;
  private cancelCalculationTimer: (() => void) | undefined;
  private calculationStartedAtMs: number | undefined;
  private currentRequest: CalculationRequest | undefined;
  private state: CalculationState = { status: 'idle' };
  private readonly listeners = new Set<(state: CalculationState) => void>();
  private disposed = false;

  constructor(options: CalculationClientOptions) {
    this.createWorker = options.createWorker;
    this.runtime = options.runtime;
    this.initializationTimeoutMs = options.initializationTimeoutMs ?? 20_000;
    this.engineInitializationTimeoutMs =
      options.engineInitializationTimeoutMs ?? 30_000;
    this.calculationTimeoutMs = options.calculationTimeoutMs ?? 31_000;
    this.workerLifetimeMs = options.workerLifetimeMs ?? 70_000;
    if (
      [
        this.initializationTimeoutMs,
        this.engineInitializationTimeoutMs,
        this.calculationTimeoutMs,
        this.workerLifetimeMs,
      ].some((ms) => !Number.isFinite(ms) || ms <= 0 || ms > 2_147_483_647)
    )
      throw new Error('Invalid Worker deadline');
  }

  subscribe(listener: (state: CalculationState) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): CalculationState {
    return this.state;
  }

  calculate(
    input: InputSnapshot,
    options: CalculationOptions,
  ): string | undefined {
    if (this.disposed) return undefined;
    this.stopWorker();
    const inputSnapshot = Object.freeze({ ...input });
    const optionsSnapshot = Object.freeze({ ...options });
    const request: CalculationRequest = {
      type: 'calculate',
      requestId: this.runtime.createRequestId(),
      ...FIXED_ROUTE_METADATA,
      input: inputSnapshot,
      options: optionsSnapshot,
    };
    Object.freeze(request);
    this.currentRequest = request;

    const validation = validateInputSnapshot(inputSnapshot);
    if (!validation.ok) {
      this.currentRequest = undefined;
      this.publish({
        status: 'failed',
        request,
        code: 'input-invalid',
        message: '入力寸法を確認してください。',
      });
      return request.requestId;
    }
    if (!validOptions(optionsSnapshot)) {
      this.currentRequest = undefined;
      this.publish({
        status: 'failed',
        request,
        code: 'invalid-request',
        message: '計算条件が不正です。',
      });
      return request.requestId;
    }

    try {
      const createdAt = this.runtime.now();
      const worker = this.createWorker();
      this.worker = worker;
      this.phase = 'boot';
      this.deadlineAt = createdAt + this.initializationTimeoutMs;
      this.lifetimeAt = createdAt + this.workerLifetimeMs;
      worker.onmessage = (event) => this.handleMessage(worker, event.data);
      worker.onerror = () => {
        if (this.checkDeadlines(worker)) return;
        this.failForOperation(
          worker,
          request,
          'worker-error',
          'Worker の計算に失敗しました。',
        );
      };
      worker.onmessageerror = () => {
        if (this.checkDeadlines(worker)) return;
        this.failForOperation(
          worker,
          request,
          'invalid-response',
          'Worker の応答を読み取れませんでした。',
        );
      };
      this.cancelInitializationTimer = this.runtime.setTimer(
        () => this.checkDeadlines(worker),
        Math.max(0, this.deadlineAt - this.runtime.now()),
      );
      this.cancelLifetimeTimer = this.runtime.setTimer(
        () => this.checkDeadlines(worker),
        Math.max(0, this.lifetimeAt - this.runtime.now()),
      );
      this.publish({ status: 'initializing', request });
    } catch {
      this.fail('worker-error', 'Worker を起動できませんでした。');
    }
    return request.requestId;
  }

  cancel(): void {
    if (!this.currentRequest || this.disposed) return;
    const request = this.currentRequest;
    this.stopWorker();
    this.currentRequest = undefined;
    this.publish({ status: 'cancelled', request });
  }

  invalidateInput(): void {
    if (this.disposed) return;
    this.stopWorker();
    this.currentRequest = undefined;
    this.publish({ status: 'idle' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopWorker();
    this.disposed = true;
    this.currentRequest = undefined;
    this.listeners.clear();
    this.state = { status: 'idle' };
  }

  private handleMessage(worker: WorkerPort, data: unknown): void {
    if (worker !== this.worker || this.checkDeadlines(worker)) return;
    if (data === null || typeof data !== 'object') {
      this.failForOperation(
        worker,
        this.currentRequest,
        'invalid-response',
        'Worker から不正な応答が届きました。',
      );
      return;
    }
    if (isRecord(data) && data.type === 'ready') {
      if (this.state.status !== 'initializing' || !this.currentRequest) return;
      const request = this.currentRequest;
      this.cancelInitializationTimer?.();
      this.cancelInitializationTimer = undefined;
      try {
        this.calculationStartedAtMs = this.runtime.now();
        this.phase = 'engine';
        this.deadlineAt =
          this.runtime.now() + this.engineInitializationTimeoutMs;
        this.cancelInitializationTimer = this.runtime.setTimer(
          () => this.checkDeadlines(worker),
          this.engineInitializationTimeoutMs,
        );
        worker.postMessage(request);
        if (worker !== this.worker || request !== this.currentRequest) return;
        this.publish({
          status: 'running',
          request,
          stage: 'initializing',
          nodesVisited: 0,
          elapsedMs: 0,
        });
      } catch {
        this.failForOperation(
          worker,
          request,
          'worker-error',
          '計算要求を Worker に送信できませんでした。',
        );
      }
      return;
    }
    const request = this.currentRequest;
    if (!request) return;
    if (
      isRecord(data) &&
      typeof data.requestId === 'string' &&
      data.requestId !== request.requestId
    ) {
      // Ignore late messages from a terminated worker before validating their payload.
      return;
    }
    if (!isCalculationResponse(data)) {
      this.failForOperation(
        worker,
        request,
        'invalid-response',
        'Worker から不正な応答が届きました。',
      );
      return;
    }
    if (
      data.requestId !== request.requestId ||
      data.routeId !== request.routeId ||
      data.direction !== request.direction ||
      data.modelVersion !== request.modelVersion ||
      !snapshotsMatch(data.input, request.input)
    ) {
      this.failForOperation(
        worker,
        request,
        'invalid-response',
        'Worker の応答が固定経路または入力条件と一致しません。',
      );
      return;
    }
    if (this.state.status !== 'running') {
      this.failForOperation(
        worker,
        request,
        'invalid-response',
        'Worker が ready を通知する前に計算応答を返しました。',
      );
      return;
    }
    if (data.type === 'progress') {
      if (data.nodesVisited > request.options.maxNodes) {
        this.failForOperation(
          worker,
          request,
          'invalid-response',
          'Worker の進捗が要求上限を超えています。',
        );
        return;
      }
      if (data.stage !== 'initializing' && this.phase === 'engine') {
        this.cancelInitializationTimer?.();
        this.cancelInitializationTimer = undefined;
        this.phase = 'compute';
        const ms = Math.min(
          this.calculationTimeoutMs,
          request.options.maxTimeMs + 1000,
        );
        this.deadlineAt = this.runtime.now() + ms;
        this.cancelCalculationTimer = this.runtime.setTimer(
          () => this.checkDeadlines(worker),
          ms,
        );
      } else if (data.stage === 'initializing' && this.phase === 'compute') {
        this.fail('invalid-response', 'Workerの計算段階が初期化へ戻りました。');
        return;
      }
      this.publish({
        status: 'running',
        request,
        stage: data.stage,
        nodesVisited: data.nodesVisited,
        elapsedMs: Math.max(
          data.elapsedMs,
          this.runtime.now() -
            (this.calculationStartedAtMs ?? this.runtime.now()),
        ),
      });
      return;
    }
    if (
      data.type === 'result' &&
      (data.result.seed !== request.options.seed ||
        data.result.nodesVisited > request.options.maxNodes)
    ) {
      this.failForOperation(
        worker,
        request,
        'invalid-response',
        'Worker の計算結果が要求条件と一致しません。',
      );
      return;
    }
    this.cancelCalculationTimer?.();
    this.cancelCalculationTimer = undefined;
    this.stopWorker();
    this.currentRequest = undefined;
    if (data.type === 'failure') {
      this.publish({
        status: 'failed',
        request,
        code: data.code,
        message: data.message,
      });
      return;
    }
    this.publish({ status: 'result', message: data });
  }

  private fail(
    code: Extract<CalculationState, { status: 'failed' }>['code'],
    message: string,
  ): void {
    const request = this.currentRequest;
    this.stopWorker();
    if (!request) return;
    this.currentRequest = undefined;
    this.publish({ status: 'failed', request, code, message });
  }

  private checkDeadlines(worker: WorkerPort): boolean {
    if (worker !== this.worker || !this.currentRequest) return true;
    const now = this.runtime.now();
    if (now >= this.lifetimeAt) {
      this.fail(
        'worker-lifetime-timeout',
        'Workerの全体期限に達しました。もう一度計算できます。',
      );
      return true;
    }
    if (now < this.deadlineAt) return false;
    if (this.phase === 'boot')
      this.fail(
        'initialization-timeout',
        'Workerの起動がタイムアウトしました。',
      );
    else if (this.phase === 'engine')
      this.fail(
        'engine-initialization-timeout',
        '住宅モデルの初期化がタイムアウトしました。',
      );
    else this.fail('calculation-timeout', '計算がタイムアウトしました。');
    return true;
  }

  private failForOperation(
    worker: WorkerPort,
    request: CalculationRequest | undefined,
    code: Extract<CalculationState, { status: 'failed' }>['code'],
    message: string,
  ): void {
    if (request && worker === this.worker && request === this.currentRequest) {
      this.fail(code, message);
    }
  }

  private stopWorker(): void {
    this.cancelInitializationTimer?.();
    this.cancelCalculationTimer?.();
    this.cancelLifetimeTimer?.();
    this.cancelInitializationTimer = undefined;
    this.cancelCalculationTimer = undefined;
    this.cancelLifetimeTimer = undefined;
    this.deadlineAt = Infinity;
    this.lifetimeAt = Infinity;
    this.calculationStartedAtMs = undefined;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  private publish(state: CalculationState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function validOptions(options: CalculationOptions): boolean {
  return (
    Number.isSafeInteger(options.seed) &&
    options.seed >= 0 &&
    options.seed <= MAX_CALCULATION_SEED &&
    Number.isSafeInteger(options.maxNodes) &&
    options.maxNodes >= MIN_CALCULATION_NODES &&
    options.maxNodes <= MAX_CALCULATION_NODES &&
    Number.isFinite(options.maxTimeMs) &&
    options.maxTimeMs >= 1 &&
    options.maxTimeMs <= MAX_CALCULATION_TIME_MS
  );
}
