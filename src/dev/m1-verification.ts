import {
  VerificationSession,
  VerificationError,
  type M1Deadlines,
  type M1Deadline,
  type TerminalMessage,
} from '../application/m1-verification-session';
import type { WorkerPort } from '../application/calculation-client';
import {
  M1_DEADLINES_MS,
  M1_LIFECYCLE_DELAYS_MS,
  M1_BOOT_DEADLINE_HOLD_MS,
  type M1Phase,
  type M1PrepareProfile,
  type M1RunProfile,
  type M1WorkerFailureMessage,
  type M1WorkerPreparedMessage,
  type M1WorkerResultMessage,
} from '../shared/m1-verification-messages';

const DEADLINE_CHECK_PROFILES: readonly {
  readonly deadline: M1Deadline;
  readonly deadlines: M1Deadlines;
  readonly workerDelayMs: number;
}[] = [
  {
    deadline: 'boot-assets',
    deadlines: { ...M1_DEADLINES_MS, bootAssets: 100 },
    workerDelayMs: M1_BOOT_DEADLINE_HOLD_MS,
  },
  {
    deadline: 'engine-init',
    deadlines: { ...M1_DEADLINES_MS, engineInit: 100 },
    workerDelayMs: M1_LIFECYCLE_DELAYS_MS.engineInit,
  },
  {
    deadline: 'compute',
    deadlines: { ...M1_DEADLINES_MS, compute: 100 },
    workerDelayMs: M1_LIFECYCLE_DELAYS_MS.computeHold,
  },
  {
    deadline: 'whole-worker-lifetime',
    deadlines: { ...M1_DEADLINES_MS, wholeWorkerLifetime: 1_200 },
    workerDelayMs: 0,
  },
];

interface M1Report {
  readonly schemaVersion: 2;
  readonly startedAt: string;
  readonly settings: {
    readonly deadlinesMs: typeof M1_DEADLINES_MS;
    readonly lifecycleDelaysMs: typeof M1_LIFECYCLE_DELAYS_MS;
    readonly measurementProfile: 'fixed-turn-fixture';
    readonly deadlineCheckProfiles: typeof DEADLINE_CHECK_PROFILES;
  };
  readonly environment: {
    readonly userAgent: string;
    readonly pageOrBrowserCacheControlled: false;
    readonly coldRunMeaning: 'new Worker and new Rapier/model initialization';
  };
  readonly workerLifecycle: {
    created: number;
    terminated: number;
  };
  readonly lifecycleChecks: Record<string, unknown>[];
  readonly deadlineChecks: Record<string, unknown>[];
  sameWorkerWarmSeries: Record<string, unknown>;
  readonly freshWorkerEngineRuns: Record<string, unknown>[];
  recreateCheck: Record<string, unknown>;
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  failure?: { phase: M1Phase; message: string; deadline: M1Deadline | null };
}

const outputNode = document.querySelector('#verification-output');
const statusNode = document.querySelector('#verification-status');
const cancelButton = document.querySelector('#cancel-verification');
const rerunButton = document.querySelector('#rerun-verification');
const downloadButton = document.querySelector('#download-verification');
if (
  !(outputNode instanceof HTMLElement) ||
  !(statusNode instanceof HTMLElement) ||
  !(cancelButton instanceof HTMLButtonElement) ||
  !(rerunButton instanceof HTMLButtonElement) ||
  !(downloadButton instanceof HTMLButtonElement)
)
  throw new Error('M1 verification page is missing required controls');
const verificationOutput = outputNode;
const verificationStatus = statusNode;
const cancelControl = cancelButton;
const rerunControl = rerunButton;
const downloadControl = downloadButton;

let report: M1Report | undefined;
let runController: AbortController | undefined;
let currentRun: Promise<void> | undefined;
const activeSessions = new Set<VerificationSession>();
let requestCounter = 0;

function updateOutput(): void {
  verificationOutput.textContent = report
    ? JSON.stringify(report, null, 2)
    : '計測を準備しています。';
}

function record(event: Record<string, unknown>): void {
  if (!report) return;
  report.lifecycleChecks.push(event);
  updateOutput();
}

function createSession(
  options: {
    deadlines?: M1Deadlines;
    bootHold?: boolean;
    onPortCreated?: (port: WorkerPort) => void;
  } = {},
): VerificationSession {
  if (!report) throw new Error('M1 report has not been initialized');
  const session = new VerificationSession({
    createWorker: () => {
      const worker = options.bootHold
        ? new Worker(
            new URL(
              '../workers/m1-verification-boot-hold.worker.ts',
              import.meta.url,
            ),
            { type: 'module' },
          )
        : new Worker(
            new URL('../workers/m1-verification.worker.ts', import.meta.url),
            { type: 'module' },
          );
      const port: WorkerPort = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage: (message) => worker.postMessage(message),
        terminate: () => {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        },
      };
      worker.onmessage = (event: MessageEvent<unknown>) =>
        port.onmessage?.({ data: event.data });
      worker.onerror = (event) => {
        event.preventDefault();
        port.onerror?.(new Error(event.message));
      };
      worker.onmessageerror = (event: MessageEvent<unknown>) =>
        port.onmessageerror?.({ data: event.data });
      options.onPortCreated?.(port);
      return port;
    },
    runtime: {
      now: () => performance.now(),
      setTimer: (callback, delayMs) => {
        const timer = window.setTimeout(callback, delayMs);
        return () => window.clearTimeout(timer);
      },
    },
    deadlines: options.deadlines ?? M1_DEADLINES_MS,
    onTerminated: () => {
      if (!report) return;
      report.workerLifecycle.terminated++;
      activeSessions.delete(session);
      updateOutput();
    },
  });
  report.workerLifecycle.created++;
  activeSessions.add(session);
  updateOutput();
  return session;
}

function nextRequestId(prefix: string): string {
  requestCounter++;
  return `${prefix}-${requestCounter}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new VerificationError('protocol', 'Verification run was cancelled');
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new VerificationError('protocol', 'Verification run was cancelled'),
      );
      return;
    }
    let timer = 0;
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(
        new VerificationError('protocol', 'Verification run was cancelled'),
      );
    };
    timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function assertPrepared(
  message: TerminalMessage,
  phase: 'engine-init',
): asserts message is M1WorkerPreparedMessage {
  if (message.type === 'failure') throw workerFailure(message);
  if (message.type === 'cancelled')
    throw new VerificationError(phase, 'Worker initialization was cancelled');
  if (message.type !== 'prepared')
    throw new VerificationError(
      phase,
      'Worker returned an unexpected init response',
    );
}

function assertResult(
  message: TerminalMessage,
  phase: 'compute',
): asserts message is M1WorkerResultMessage {
  if (message.type === 'failure') throw workerFailure(message);
  if (message.type === 'cancelled')
    throw new VerificationError(phase, 'Worker computation was cancelled');
  if (message.type !== 'result')
    throw new VerificationError(
      phase,
      'Worker returned an unexpected compute response',
    );
}

function workerFailure(message: M1WorkerFailureMessage): VerificationError {
  return new VerificationError(
    message.phase,
    `Worker ${message.code}: ${message.message}`,
  );
}

async function prepareSession(
  session: VerificationSession,
  profile: M1PrepareProfile,
  signal: AbortSignal,
): Promise<{ readonly bootAssetsMs: number; readonly initMs: number }> {
  const bootAssetsMs = await session.ready;
  throwIfAborted(signal);
  const command = session.command({
    type: 'prepare',
    requestId: nextRequestId('prepare'),
    profile,
  });
  await command.stage;
  throwIfAborted(signal);
  const reply = await command.response;
  throwIfAborted(signal);
  assertPrepared(reply, 'engine-init');
  return { bootAssetsMs, initMs: reply.initMs };
}

async function runSession(
  session: VerificationSession,
  profile: M1RunProfile,
  signal: AbortSignal,
): Promise<{
  readonly computeMs: number;
  readonly cycleResponseMs: number;
  readonly workerLifetimeThroughResultMs: number;
  readonly result: M1WorkerResultMessage['result'];
}> {
  throwIfAborted(signal);
  const command = session.command({
    type: 'run',
    requestId: nextRequestId('run'),
    profile,
  });
  await command.stage;
  throwIfAborted(signal);
  const reply = await command.response;
  throwIfAborted(signal);
  assertResult(reply, 'compute');
  return {
    computeMs: reply.computeMs,
    cycleResponseMs: performance.now() - command.sentAt,
    workerLifetimeThroughResultMs: session.workerLifetimeMs,
    result: reply.result,
  };
}

async function runLifecycleChecks(signal: AbortSignal): Promise<void> {
  let port: WorkerPort | undefined;
  const session = createSession({
    onPortCreated: (created) => {
      port = created;
    },
  });
  try {
    await session.ready;
    const cancelledInit = session.command({
      type: 'prepare',
      requestId: nextRequestId('lifecycle-init-cancel'),
      profile: 'lifecycle-delay-1500ms',
    });
    await cancelledInit.stage;
    await wait(75, signal);
    session.cancel(cancelledInit.requestId);
    const cancelledInitReply = await cancelledInit.response;
    if (
      cancelledInitReply.type !== 'cancelled' ||
      cancelledInitReply.phase !== 'engine-init'
    )
      throw new VerificationError(
        'engine-init',
        'Initialization cancellation did not complete as expected',
      );
    record({
      check: 'cancel-init-then-retry',
      cancelled: true,
      cancelledPhase: cancelledInitReply.phase,
      profile: 'lifecycle-delay-1500ms',
    });

    const initRetryStartedAt = performance.now();
    const initRetry = session.command({
      type: 'prepare',
      requestId: nextRequestId('lifecycle-init-retry'),
      profile: 'lifecycle-delay-1500ms',
    });
    await initRetry.stage;
    const initRetryReply = await initRetry.response;
    assertPrepared(initRetryReply, 'engine-init');
    const initRetryElapsedMs = performance.now() - initRetryStartedAt;
    if (initRetryElapsedMs < 1_400)
      throw new VerificationError(
        'engine-init',
        'The fixed initialization lifecycle delay was not observed',
      );
    record({
      check: 'init-retry-delay-profile',
      profile: 'lifecycle-delay-1500ms',
      elapsedMs: initRetryElapsedMs,
      workerInitMs: initRetryReply.initMs,
      excludedFromPerformanceSamples: true,
    });

    const heldRunStartedAt = performance.now();
    const heldRun = session.command({
      type: 'run',
      requestId: nextRequestId('lifecycle-compute-hold'),
      profile: 'lifecycle-hold-300ms',
    });
    await heldRun.stage;
    const heldRunReply = await heldRun.response;
    assertResult(heldRunReply, 'compute');
    const holdElapsedMs = performance.now() - heldRunStartedAt;
    if (holdElapsedMs < 280)
      throw new VerificationError(
        'compute',
        'The fixed computation lifecycle hold was not observed',
      );
    record({
      check: 'compute-hold-profile',
      profile: 'lifecycle-hold-300ms',
      elapsedMs: holdElapsedMs,
      workerComputeMs: heldRunReply.computeMs,
      excludedFromPerformanceSamples: true,
    });

    // Emulate a cancellation queued behind a completed command. The transport
    // must ignore it so the next request on this same Worker can proceed.
    port?.postMessage({ type: 'cancel', requestId: heldRun.requestId });

    const cancelledCompute = session.command({
      type: 'run',
      requestId: nextRequestId('lifecycle-compute-cancel'),
      profile: 'lifecycle-hold-300ms',
    });
    await cancelledCompute.stage;
    await wait(50, signal);
    session.cancel(cancelledCompute.requestId);
    const cancelledComputeReply = await cancelledCompute.response;
    if (
      cancelledComputeReply.type !== 'cancelled' ||
      cancelledComputeReply.phase !== 'compute'
    )
      throw new VerificationError(
        'compute',
        'Computation cancellation did not complete as expected',
      );
    const retry = await runSession(session, 'measurement', signal);
    record({
      check: 'cancel-before-compute-hold-then-same-worker-retry',
      cancelled: true,
      cancelledPhase: cancelledComputeReply.phase,
      retryComputeMs: retry.computeMs,
      retryStatus: 'completed',
      excludedFromPerformanceSamples: true,
    });
    record({
      check: 'late-cancel-after-completed-command',
      retryStatus: 'completed',
      excludedFromPerformanceSamples: true,
    });
  } finally {
    session.terminate();
  }
}

async function runRecreateCheck(signal: AbortSignal): Promise<void> {
  const activeReport = report;
  if (!activeReport) throw new Error('M1 report has not been initialized');
  const createdBefore = activeReport.workerLifecycle.created;
  const terminatedBefore = activeReport.workerLifecycle.terminated;
  const elapsedStartedAt = performance.now();
  for (let index = 0; index < 20; index++) {
    throwIfAborted(signal);
    const session = createSession();
    try {
      await session.ready;
    } finally {
      session.terminate();
    }
  }
  const created = activeReport.workerLifecycle.created - createdBefore;
  const terminated = activeReport.workerLifecycle.terminated - terminatedBefore;
  activeReport.recreateCheck = {
    requested: 20,
    scope: 'ready-only, no Rapier/model initialization',
    created,
    terminated,
    elapsedMs: performance.now() - elapsedStartedAt,
    passed: created === 20 && terminated === 20,
  };
  if (created !== 20 || terminated !== 20)
    throw new VerificationError('protocol', 'Worker recreate lifecycle leaked');
  updateOutput();
}

async function runDeadlineChecks(signal: AbortSignal): Promise<void> {
  const activeReport = report;
  if (!activeReport) throw new Error('Missing report');
  for (const profile of DEADLINE_CHECK_PROFILES) {
    throwIfAborted(signal);
    const session = createSession({
      deadlines: profile.deadlines,
      bootHold: profile.deadline === 'boot-assets',
    });
    let failure: VerificationError | undefined;
    let completedBeforeIdle = false;
    try {
      if (profile.deadline === 'boot-assets') await session.ready;
      else if (profile.deadline === 'engine-init')
        await prepareSession(session, 'lifecycle-delay-1500ms', signal);
      else {
        await prepareSession(session, 'measurement', signal);
        if (profile.deadline === 'compute')
          await runSession(session, 'lifecycle-hold-300ms', signal);
        else {
          // A completed command must not reset the generation-based lifetime.
          await runSession(session, 'measurement', signal);
          completedBeforeIdle = true;
          failure = await session.closed;
        }
      }
    } catch (error) {
      if (error instanceof VerificationError) failure = error;
      else throw error;
    } finally {
      session.terminate();
    }
    throwIfAborted(signal);
    if (failure?.deadline !== profile.deadline)
      throw (
        failure ??
        new VerificationError('protocol', 'Expected deadline did not expire')
      );
    if (profile.deadline === 'whole-worker-lifetime' && !completedBeforeIdle)
      throw new VerificationError(
        'protocol',
        'Lifetime probe expired before completing the command; idle lifetime was not verified',
      );
    // Each retry uses a fresh Worker with the normal, unchanged deadlines.
    const retry = createSession();
    try {
      await prepareSession(retry, 'measurement', signal);
      const result = await runSession(retry, 'measurement', signal);
      activeReport.deadlineChecks.push({
        check: 'deadline-then-fresh-worker-retry',
        profile: `${profile.deadline}-short-deadline`,
        deadlinesMs: profile.deadlines,
        workerDelayMs: profile.workerDelayMs,
        failure: {
          phase: failure.phase,
          deadline: failure.deadline,
          message: failure.message,
        },
        failedWorkerLifetimeMs: session.workerLifetimeMs,
        idleLifetimeVerified:
          profile.deadline === 'whole-worker-lifetime'
            ? completedBeforeIdle
            : null,
        retryStatus: 'completed',
        retryComputeMs: result.computeMs,
        excludedFromPerformanceSamples: true,
      });
      updateOutput();
    } finally {
      retry.terminate();
    }
  }
}

async function runSameWorkerSeries(signal: AbortSignal): Promise<void> {
  const activeReport = report;
  if (!activeReport) throw new Error('M1 report has not been initialized');
  const session = createSession();
  try {
    const initialization = await prepareSession(session, 'measurement', signal);
    const runs: Record<string, unknown>[] = [];
    for (let index = 0; index < 5; index++) {
      const sample = await runSession(session, 'measurement', signal);
      runs.push({
        iteration: index + 1,
        computeState:
          index === 0
            ? 'first-compute-after-engine-init'
            : 'same-worker-repeat',
        ...sample,
      });
      activeReport.sameWorkerWarmSeries = {
        bootAssetsMs: initialization.bootAssetsMs,
        engineInitMs: initialization.initMs,
        runs,
      };
      updateOutput();
    }
    activeReport.sameWorkerWarmSeries = {
      bootAssetsMs: initialization.bootAssetsMs,
      engineInitMs: initialization.initMs,
      runs,
      completedRuns: runs.length,
      cacheState: 'uncontrolled',
    };
    updateOutput();
  } finally {
    session.terminate();
  }
}

async function runFreshWorkerEngineSeries(signal: AbortSignal): Promise<void> {
  const activeReport = report;
  if (!activeReport) throw new Error('M1 report has not been initialized');
  for (let index = 0; index < 5; index++) {
    throwIfAborted(signal);
    const session = createSession();
    try {
      const initialization = await prepareSession(
        session,
        'measurement',
        signal,
      );
      const sample = await runSession(session, 'measurement', signal);
      activeReport.freshWorkerEngineRuns.push({
        iteration: index + 1,
        bootAssetsMs: initialization.bootAssetsMs,
        engineInitMs: initialization.initMs,
        cacheState: 'uncontrolled',
        ...sample,
      });
      updateOutput();
    } finally {
      session.terminate();
    }
  }
}

async function executeVerification(signal: AbortSignal): Promise<void> {
  const activeReport = report;
  if (!activeReport) throw new Error('M1 report has not been initialized');
  await runLifecycleChecks(signal);
  await runDeadlineChecks(signal);
  await runRecreateCheck(signal);
  await runSameWorkerSeries(signal);
  await runFreshWorkerEngineSeries(signal);
  if (
    activeReport.workerLifecycle.created !==
    activeReport.workerLifecycle.terminated
  )
    throw new VerificationError(
      'protocol',
      'Worker create/terminate totals differ',
    );
  activeReport.status = 'passed';
  updateOutput();
}

function startVerification(): void {
  if (currentRun) return;
  const controller = new AbortController();
  runController = controller;
  report = {
    schemaVersion: 2,
    startedAt: new Date().toISOString(),
    settings: {
      deadlinesMs: M1_DEADLINES_MS,
      lifecycleDelaysMs: M1_LIFECYCLE_DELAYS_MS,
      measurementProfile: 'fixed-turn-fixture',
      deadlineCheckProfiles: DEADLINE_CHECK_PROFILES,
    },
    environment: {
      userAgent: navigator.userAgent,
      pageOrBrowserCacheControlled: false,
      coldRunMeaning: 'new Worker and new Rapier/model initialization',
    },
    workerLifecycle: { created: 0, terminated: 0 },
    lifecycleChecks: [],
    deadlineChecks: [],
    sameWorkerWarmSeries: { completedRuns: 0, runs: [] },
    freshWorkerEngineRuns: [],
    recreateCheck: { requested: 20, created: 0, terminated: 0, passed: false },
    status: 'running',
  };
  verificationStatus.textContent =
    'M1固定fixtureのライフサイクル検証と計測を実行中';
  cancelControl.disabled = false;
  rerunControl.disabled = true;
  downloadControl.disabled = true;
  updateOutput();

  currentRun = executeVerification(controller.signal)
    .catch((error: unknown) => {
      if (!report) return;
      const failurePhase =
        error instanceof VerificationError ? error.phase : 'protocol';
      const cancelled = controller.signal.aborted;
      report.status = cancelled ? 'cancelled' : 'failed';
      report.failure = {
        phase: failurePhase,
        message: error instanceof Error ? error.message : String(error),
        deadline:
          error instanceof VerificationError ? (error.deadline ?? null) : null,
      };
      for (const session of activeSessions) session.terminate();
      updateOutput();
    })
    .finally(() => {
      runController = undefined;
      currentRun = undefined;
      cancelControl.disabled = true;
      rerunControl.disabled = false;
      downloadControl.disabled = report === undefined;
      if (report)
        verificationStatus.textContent =
          report.status === 'passed'
            ? '完了: 全計測・ライフサイクル検査が成功しました'
            : report.status === 'cancelled'
              ? '中止しました。記録はJSONで保存できます'
              : '失敗しました。failure.phaseとmessageを確認してください';
    });
}

cancelControl.addEventListener('click', () => {
  if (!runController) return;
  runController.abort();
  for (const session of activeSessions) session.terminate();
  verificationStatus.textContent = '中止処理中';
});
rerunControl.addEventListener('click', startVerification);
window.addEventListener('pagehide', () => {
  runController?.abort();
  for (const session of activeSessions) session.terminate();
});
downloadControl.addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'carrycheck-m1-verification.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

startVerification();
