import { describe, expect, it, vi } from 'vitest';
import type { WorkerPort } from '../src/application/calculation-client';
import {
  VerificationSession,
  type M1Deadlines,
  type VerificationRuntime,
} from '../src/application/m1-verification-session';
import {
  M1_DEADLINES_MS,
  M1_PROTOCOL_VERSION,
} from '../src/shared/m1-verification-messages';

class Clock implements VerificationRuntime {
  time = 0;
  readonly tasks = new Map<number, { at: number; callback: () => void }>();
  private nextId = 0;
  now = () => this.time;
  setTimer = (callback: () => void, delayMs: number) => {
    const id = ++this.nextId;
    this.tasks.set(id, { at: this.time + delayMs, callback });
    return () => {
      this.tasks.delete(id);
    };
  };
  advance(target: number) {
    for (;;) {
      const next = [...this.tasks.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      )[0];
      if (!next || next[1].at > target) break;
      this.time = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  sent: unknown[] = [];
  terminations = 0;
  throwOnSend = false;
  postMessage(message: unknown) {
    if (this.throwOnSend) throw new Error('send failed');
    this.sent.push(message);
  }
  terminate() {
    this.terminations++;
  }
  emit(message: unknown) {
    this.onmessage?.({ data: message });
  }
}

function setup(deadlines: M1Deadlines = M1_DEADLINES_MS) {
  const clock = new Clock();
  const worker = new FakeWorker();
  const onTerminated = vi.fn();
  const session = new VerificationSession({
    createWorker: () => worker,
    runtime: clock,
    onTerminated,
    deadlines,
  });
  return { clock, worker, onTerminated, session };
}
const ready = { type: 'ready', protocolVersion: M1_PROTOCOL_VERSION };
const request = (type: 'prepare' | 'run', requestId = type) =>
  ({ type, requestId, profile: 'measurement' }) as const;
const stage = (type: 'prepare' | 'run', requestId = type) => ({
  type: 'stage',
  requestId,
  phase: type === 'prepare' ? 'engine-init' : 'compute',
  profile: 'measurement',
});
const completed = (type: 'prepare' | 'run', requestId = type) =>
  type === 'prepare'
    ? { type: 'prepared', requestId, initMs: 1 }
    : { type: 'result', requestId, result: { scope: 'test' }, computeMs: 1 };

describe('M1 fixed deadline session', () => {
  it('counts Worker construction time and freezes lifetime at termination', async () => {
    const clock = new Clock();
    const worker = new FakeWorker();
    const session = new VerificationSession({
      createWorker: () => {
        clock.time = 19_000;
        return worker;
      },
      runtime: clock,
      onTerminated: () => {},
    });
    clock.advance(20_000);
    await expect(session.ready).rejects.toMatchObject({
      deadline: 'boot-assets',
    });
    clock.advance(50_000);
    expect(session.workerLifetimeMs).toBe(20_000);
  });

  it.each(['error', 'message-error'] as const)(
    'classifies late %s as deadline even before the timer callback',
    async (mode) => {
      const { session, worker, clock } = setup();
      worker.emit(ready);
      const command = session.command(request('run'));
      clock.time = 15_000;
      if (mode === 'error')
        worker.onerror?.(new Error('late transport failure'));
      else worker.onmessageerror?.({ data: null });
      await expect(command.response).rejects.toMatchObject({
        deadline: 'compute',
      });
      expect(clock.tasks.size).toBe(0);
    },
  );
  it('expires boot at the normal 20-second boundary, releases handlers, and terminates once', async () => {
    const { session, worker, clock, onTerminated } = setup();
    const handler = worker.onmessage;
    const queuedTimers = [...clock.tasks.values()].map((t) => t.callback);
    clock.advance(19_999);
    expect(worker.terminations).toBe(0);
    clock.advance(20_000);
    await expect(session.ready).rejects.toMatchObject({
      phase: 'boot-assets',
      deadline: 'boot-assets',
    });
    await expect(session.closed).resolves.toMatchObject({
      deadline: 'boot-assets',
    });
    handler?.({ data: ready });
    for (const callback of queuedTimers) callback();
    session.terminate();
    expect(worker.terminations).toBe(1);
    expect(onTerminated).toHaveBeenCalledTimes(1);
    expect(clock.tasks.size).toBe(0);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it.each(['prepare', 'run'] as const)(
    'rejects both pending promises when %s expires before its stage',
    async (type) => {
      const { session, worker, clock } = setup();
      worker.emit(ready);
      await session.ready;
      const command = session.command(request(type));
      const deadline = type === 'prepare' ? 30_000 : 15_000;
      clock.advance(deadline - 1);
      expect(worker.terminations).toBe(0);
      clock.advance(deadline);
      const error = {
        phase: type === 'prepare' ? 'engine-init' : 'compute',
        deadline: type === 'prepare' ? 'engine-init' : 'compute',
      };
      await expect(command.stage).rejects.toMatchObject(error);
      await expect(command.response).rejects.toMatchObject(error);
      expect(clock.tasks.size).toBe(0);
    },
  );

  it.each(['prepare', 'run'] as const)(
    'does not reset the %s deadline on late stage notification',
    async (type) => {
      const { session, worker, clock } = setup();
      worker.emit(ready);
      await session.ready;
      const command = session.command(request(type));
      const ms = type === 'prepare' ? 30_000 : 15_000;
      clock.advance(ms - 1);
      worker.emit(stage(type));
      await command.stage;
      clock.advance(ms);
      await expect(command.response).rejects.toMatchObject({
        deadline: type === 'prepare' ? 'engine-init' : 'compute',
      });
      expect(worker.terminations).toBe(1);
    },
  );

  it.each(['ready', 'prepare', 'run'] as const)(
    'rejects a late %s message even before the queued timer callback runs',
    async (type) => {
      const { session, worker, clock } = setup();
      if (type === 'ready') {
        clock.time = 20_000;
        worker.emit(ready);
        await expect(session.ready).rejects.toMatchObject({
          deadline: 'boot-assets',
        });
      } else {
        worker.emit(ready);
        await session.ready;
        const command = session.command(request(type));
        worker.emit(stage(type));
        await command.stage;
        clock.time = type === 'prepare' ? 30_000 : 15_000;
        worker.emit(completed(type));
        await expect(command.response).rejects.toMatchObject({
          deadline: type === 'prepare' ? 'engine-init' : 'compute',
        });
      }
      expect(worker.terminations).toBe(1);
      expect(clock.tasks.size).toBe(0);
    },
  );

  it('keeps the generation deadline through completed commands and idle gaps', async () => {
    const { session, worker, clock } = setup();
    clock.advance(19_999);
    worker.emit(ready);
    await session.ready;
    clock.advance(40_000);
    const init = session.command(request('prepare'));
    worker.emit(stage('prepare'));
    worker.emit(completed('prepare'));
    await init.response;
    clock.advance(60_000);
    const run = session.command(request('run'));
    worker.emit(stage('run'));
    worker.emit(completed('run'));
    await run.response;
    expect(clock.tasks.size).toBe(1);
    clock.advance(69_999);
    expect(worker.terminations).toBe(0);
    clock.advance(70_000);
    await expect(session.closed).resolves.toMatchObject({
      phase: 'protocol',
      deadline: 'whole-worker-lifetime',
    });
    expect(clock.tasks.size).toBe(0);
  });

  it('lets worker lifetime expire during a command whose own deadline is later', async () => {
    const { session, worker, clock } = setup();
    worker.emit(ready);
    await session.ready;
    clock.advance(69_000);
    const command = session.command(request('run'));
    worker.emit(stage('run'));
    await command.stage;
    clock.advance(70_000);
    await expect(command.response).rejects.toMatchObject({
      phase: 'compute',
      deadline: 'whole-worker-lifetime',
    });
    expect(clock.tasks.size).toBe(0);
  });

  it('gives lifetime priority at an exact tie with the phase deadline', async () => {
    const { session, worker, clock } = setup({
      ...M1_DEADLINES_MS,
      compute: 70_000,
    });
    worker.emit(ready);
    await session.ready;
    const command = session.command(request('run'));
    worker.emit(stage('run'));
    clock.time = 70_000;
    worker.emit(completed('run'));
    await expect(command.response).rejects.toMatchObject({
      deadline: 'whole-worker-lifetime',
    });
  });

  it('cannot start a command after lifetime even if its timer has not fired', async () => {
    const { session, worker, clock } = setup();
    worker.emit(ready);
    await session.ready;
    clock.time = 70_000;
    expect(() => session.command(request('run'))).toThrow(
      'Whole worker lifetime',
    );
    expect(worker.sent).toHaveLength(0);
    expect(clock.tasks.size).toBe(0);
  });

  it('isolates an expired worker and permits the same request ID on a fresh session', async () => {
    const previous = setup();
    previous.worker.emit(ready);
    await previous.session.ready;
    const old = previous.session.command(request('prepare'));
    const oldHandler = previous.worker.onmessage;
    previous.clock.advance(30_000);
    await expect(old.response).rejects.toMatchObject({
      deadline: 'engine-init',
    });
    const next = setup();
    next.worker.emit(ready);
    await next.session.ready;
    const retry = next.session.command(request('prepare'));
    oldHandler?.({ data: stage('prepare') });
    oldHandler?.({ data: completed('prepare') });
    expect(next.worker.terminations).toBe(0);
    next.worker.emit(stage('prepare'));
    next.worker.emit(completed('prepare'));
    await expect(retry.response).resolves.toMatchObject({ type: 'prepared' });
    next.session.terminate();
    expect(next.clock.tasks.size).toBe(0);
  });

  it('rejects same-session ID reuse and ignores an already-completed cancel', async () => {
    const { session, worker, clock } = setup();
    expect(() => session.command(request('prepare'))).toThrow('not ready');
    worker.emit(ready);
    await session.ready;
    const command = session.command(request('prepare'));
    worker.emit(stage('prepare'));
    worker.emit(completed('prepare'));
    await command.response;
    expect(() => session.command(request('prepare'))).toThrow('not ready');
    session.cancel('prepare');
    expect(worker.sent).toHaveLength(1);
    session.terminate();
    expect(clock.tasks.size).toBe(0);
  });

  it.each(['send', 'cancel', 'error', 'message-error', 'terminate'] as const)(
    'settles a pending command and clears all timers on %s failure',
    async (mode) => {
      const { session, worker, clock, onTerminated } = setup();
      worker.emit(ready);
      await session.ready;
      worker.throwOnSend = mode === 'send';
      const command = session.command(request('run'));
      if (mode === 'cancel') {
        worker.throwOnSend = true;
        session.cancel('run');
      }
      if (mode === 'error') worker.onerror?.(new Error('transport failed'));
      if (mode === 'message-error') worker.onmessageerror?.({ data: null });
      if (mode === 'terminate') session.terminate();
      await expect(command.stage).rejects.toBeInstanceOf(Error);
      await expect(command.response).rejects.toBeInstanceOf(Error);
      expect(clock.tasks.size).toBe(0);
      expect(worker.terminations).toBe(1);
      session.terminate();
      expect(onTerminated).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a mismatched cancellation phase instead of completing a retry', async () => {
    const { session, worker, clock } = setup();
    worker.emit(ready);
    await session.ready;
    const command = session.command(request('run'));
    worker.emit(stage('run'));
    worker.emit({ type: 'cancelled', requestId: 'run', phase: 'engine-init' });
    await expect(command.response).rejects.toMatchObject({ phase: 'protocol' });
    expect(clock.tasks.size).toBe(0);
  });

  it.each([0, -1, Infinity, NaN, 2_147_483_648])(
    'rejects unsupported deadline %s before allocating a Worker',
    (ms) => {
      const factory = vi.fn(() => new FakeWorker());
      const clock = new Clock();
      expect(
        () =>
          new VerificationSession({
            createWorker: factory,
            runtime: clock,
            onTerminated: () => {},
            deadlines: { ...M1_DEADLINES_MS, bootAssets: ms },
          }),
      ).toThrow('Invalid M1 deadlines');
      expect(factory).not.toHaveBeenCalled();
      expect(clock.tasks.size).toBe(0);
    },
  );
});
