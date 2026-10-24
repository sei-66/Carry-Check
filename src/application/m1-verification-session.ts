import type { WorkerPort } from './calculation-client';
import {
  isM1WorkerMessage,
  isM1WorkerRequest,
  M1_DEADLINES_MS,
  type M1Phase,
  type M1PrepareProfile,
  type M1RunProfile,
  type M1WorkerMessage,
  type M1WorkerRequest,
} from '../shared/m1-verification-messages';

export type M1Deadlines = {
  readonly [K in keyof typeof M1_DEADLINES_MS]: number;
};
export type M1Deadline = Exclude<M1Phase, 'protocol'> | 'whole-worker-lifetime';
export type TerminalMessage = Exclude<
  M1WorkerMessage,
  { type: 'ready' } | { type: 'stage' }
>;

export class VerificationError extends Error {
  constructor(
    readonly phase: M1Phase,
    message: string,
    readonly deadline?: M1Deadline,
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}

export interface VerificationRuntime {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => () => void;
}

interface PendingCommand {
  readonly requestId: string;
  readonly phase: 'engine-init' | 'compute';
  readonly profile: M1PrepareProfile | M1RunProfile;
  readonly expected: 'prepared' | 'result';
  readonly deadlineAt: number;
  readonly resolveResponse: (message: TerminalMessage) => void;
  readonly rejectResponse: (error: Error) => void;
  readonly resolveStage: () => void;
  readonly rejectStage: (error: Error) => void;
  readonly stopTimer: () => void;
  stageSeen: boolean;
  stageSettled: boolean;
}

/** Dedicated verification transport. It does not run the product calculation. */
export class VerificationSession {
  readonly createdAt: number;
  readonly ready: Promise<number>;
  readonly closed: Promise<VerificationError>;
  private readonly worker: WorkerPort;
  private readonly runtime: VerificationRuntime;
  private readonly deadlines: M1Deadlines;
  private readonly onTerminated: () => void;
  private readonly resolveReady: (elapsedMs: number) => void;
  private readonly rejectReady: (error: Error) => void;
  private readonly resolveClosed: (error: VerificationError) => void;
  private readonly stopBootTimer: () => void;
  private readonly stopLifetimeTimer: () => void;
  private pending: PendingCommand | undefined;
  private readySettled = false;
  private readySeen = false;
  private terminated = false;
  private closeReason: VerificationError | undefined;
  private closedAt: number | undefined;
  private readonly usedRequestIds = new Set<string>();

  constructor(options: {
    readonly createWorker: () => WorkerPort;
    readonly runtime: VerificationRuntime;
    readonly onTerminated: () => void;
    readonly deadlines?: M1Deadlines;
  }) {
    this.deadlines = { ...(options.deadlines ?? M1_DEADLINES_MS) };
    if (
      Object.values(this.deadlines).some(
        (ms) => !Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647,
      )
    )
      throw new VerificationError('protocol', 'Invalid M1 deadlines');
    this.runtime = options.runtime;
    this.onTerminated = options.onTerminated;
    this.createdAt = this.runtime.now();
    // A factory failure allocates no promises or timers owned by this session.
    this.worker = options.createWorker();
    let resolveReady!: (elapsedMs: number) => void;
    let rejectReady!: (error: Error) => void;
    let resolveClosed!: (error: VerificationError) => void;
    this.ready = new Promise<number>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.closed = new Promise<VerificationError>((resolve) => {
      resolveClosed = resolve;
    });
    this.resolveReady = resolveReady;
    this.rejectReady = rejectReady;
    this.resolveClosed = resolveClosed;
    void this.ready.catch(() => undefined);
    this.stopBootTimer = this.runtime.setTimer(
      () => this.checkDeadlines(),
      Math.max(
        0,
        this.createdAt + this.deadlines.bootAssets - this.runtime.now(),
      ),
    );
    this.stopLifetimeTimer = this.runtime.setTimer(
      () => this.checkDeadlines(),
      Math.max(
        0,
        this.createdAt +
          this.deadlines.wholeWorkerLifetime -
          this.runtime.now(),
      ),
    );
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => {
      if (this.checkDeadlines()) return;
      const message = event instanceof Error ? event.message : 'Worker error';
      this.fail(new VerificationError(this.activePhase(), message));
    };
    this.worker.onmessageerror = () => {
      if (this.checkDeadlines()) return;
      this.fail(
        new VerificationError(
          this.activePhase(),
          'Worker message could not be deserialized',
        ),
      );
    };
  }

  get workerLifetimeMs(): number {
    return (this.closedAt ?? this.runtime.now()) - this.createdAt;
  }

  command(request: Extract<M1WorkerRequest, { type: 'prepare' | 'run' }>) {
    if (this.terminated || this.checkDeadlines())
      throw (
        this.closeReason ?? new VerificationError('protocol', 'Worker closed')
      );
    if (
      !this.readySeen ||
      this.pending ||
      !isM1WorkerRequest(request) ||
      this.usedRequestIds.has(request.requestId)
    )
      throw new VerificationError(
        'protocol',
        'Worker is not ready for request',
      );
    this.usedRequestIds.add(request.requestId);
    const phase = request.type === 'prepare' ? 'engine-init' : 'compute';
    const deadlineMs =
      phase === 'engine-init'
        ? this.deadlines.engineInit
        : this.deadlines.compute;
    let resolveResponse!: (message: TerminalMessage) => void;
    let rejectResponse!: (error: Error) => void;
    let resolveStage!: () => void;
    let rejectStage!: (error: Error) => void;
    const response = new Promise<TerminalMessage>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const stage = new Promise<void>((resolve, reject) => {
      resolveStage = resolve;
      rejectStage = reject;
    });
    void response.catch(() => undefined);
    void stage.catch(() => undefined);
    const sentAt = this.runtime.now();
    this.pending = {
      requestId: request.requestId,
      phase,
      profile: request.profile,
      expected: request.type === 'prepare' ? 'prepared' : 'result',
      deadlineAt: sentAt + deadlineMs,
      resolveResponse,
      rejectResponse,
      resolveStage,
      rejectStage,
      stopTimer: this.runtime.setTimer(() => this.checkDeadlines(), deadlineMs),
      stageSeen: false,
      stageSettled: false,
    };
    try {
      this.worker.postMessage(request);
    } catch (error) {
      this.fail(
        new VerificationError(
          phase,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    return { response, stage, requestId: request.requestId, sentAt };
  }

  cancel(requestId: string): void {
    if (this.terminated || this.pending?.requestId !== requestId) return;
    if (this.checkDeadlines()) return;
    try {
      this.worker.postMessage({ type: 'cancel', requestId });
    } catch (error) {
      this.fail(
        new VerificationError(
          this.activePhase(),
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  terminate(): void {
    this.fail(
      new VerificationError(this.activePhase(), 'Worker was terminated'),
    );
  }

  private activePhase(): M1Phase {
    return this.pending?.phase ?? (this.readySeen ? 'protocol' : 'boot-assets');
  }

  private checkDeadlines(): boolean {
    if (this.terminated) return true;
    const now = this.runtime.now();
    // Lifetime wins simultaneous expiration. Stage notifications never extend it.
    if (now >= this.createdAt + this.deadlines.wholeWorkerLifetime) {
      this.fail(
        new VerificationError(
          this.activePhase(),
          'Whole worker lifetime deadline exceeded',
          'whole-worker-lifetime',
        ),
      );
      return true;
    }
    if (!this.readySeen && now >= this.createdAt + this.deadlines.bootAssets) {
      this.fail(
        new VerificationError(
          'boot-assets',
          'Worker boot deadline exceeded',
          'boot-assets',
        ),
      );
      return true;
    }
    if (this.pending && now >= this.pending.deadlineAt) {
      this.fail(
        new VerificationError(
          this.pending.phase,
          `${this.pending.phase} deadline exceeded`,
          this.pending.phase,
        ),
      );
      return true;
    }
    return false;
  }

  private receive(raw: unknown): void {
    // Timer callbacks may be delayed by the main thread; late responses still fail.
    if (this.terminated || this.checkDeadlines()) return;
    const protocolError = (message: string) =>
      this.fail(new VerificationError('protocol', message));
    if (!isM1WorkerMessage(raw)) {
      protocolError('Worker response failed the M1 protocol guard');
      return;
    }
    if (raw.type === 'ready') {
      if (this.readySeen || this.pending) {
        protocolError('Unexpected duplicate Worker ready message');
        return;
      }
      this.readySeen = true;
      this.stopBootTimer();
      this.readySettled = true;
      this.resolveReady(this.workerLifetimeMs);
      return;
    }
    const pending = this.pending;
    if (!pending || raw.requestId !== pending.requestId) {
      protocolError('Worker response did not match the active request');
      return;
    }
    if (raw.type === 'stage') {
      if (
        pending.stageSeen ||
        raw.phase !== pending.phase ||
        raw.profile !== pending.profile
      ) {
        protocolError('Worker stage did not match the active request');
        return;
      }
      pending.stageSeen = true;
      pending.stageSettled = true;
      pending.resolveStage();
      return;
    }
    if (raw.type !== 'failure' && !pending.stageSeen) {
      protocolError('Worker completed before announcing its stage');
      return;
    }
    if (
      (raw.type === 'cancelled' && raw.phase !== pending.phase) ||
      (raw.type !== 'cancelled' &&
        raw.type !== 'failure' &&
        raw.type !== pending.expected)
    ) {
      protocolError('Worker response type or phase did not match the request');
      return;
    }
    pending.stopTimer();
    this.pending = undefined;
    if (!pending.stageSettled) {
      pending.stageSettled = true;
      pending.resolveStage();
    }
    pending.resolveResponse(raw);
  }

  private fail(error: VerificationError): void {
    if (this.terminated) return;
    this.terminated = true;
    this.closedAt = this.runtime.now();
    this.closeReason = error;
    this.stopBootTimer();
    this.stopLifetimeTimer();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    if (!this.readySettled) {
      this.readySettled = true;
      this.rejectReady(error);
    }
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      pending.stopTimer();
      if (!pending.stageSettled) pending.rejectStage(error);
      pending.rejectResponse(error);
    }
    try {
      this.worker.terminate();
    } finally {
      this.resolveClosed(error);
      this.onTerminated();
    }
  }
}
