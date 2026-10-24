import {
  CalculationClient,
  type WorkerPort,
} from '../application/calculation-client';
import {
  validateInputSnapshot,
  type InputSnapshot,
} from '../domain/dimensions';
import {
  createCalculationRuntime,
  createCalculationWorker,
} from '../hooks/create-calculation-worker';
import { isRecord, type PathFoundResult } from '../shared/calculation-messages';
import type { ViewerFrameMetrics } from '../viewer/create-route-viewer';
import { FIXED_ROUTE } from '../shared/fixed-route';
import { FURNITURE_SIZE_CASES } from './furniture-size-cases';

const output = document.querySelector<HTMLPreElement>('#performance-output')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
const report: Record<string, unknown> = {
  userAgent: navigator.userAgent,
  hardwareConcurrency: navigator.hardwareConcurrency,
  devicePixelRatio: window.devicePixelRatio,
  conditions:
    'local preview; no network/CPU throttling; browser cache not forcibly cleared',
};
const show = () => {
  output.textContent = JSON.stringify(report, null, 2);
};
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const quantile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    null
  );
};
async function run(action: () => Promise<void>) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  delete report.error;
  try {
    await action();
  } catch (error) {
    report.error = String(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    show();
  }
}

buttons[0]!.onclick = () => {
  void run(async () => {
    const holder = document.querySelector<HTMLDivElement>('#product-frame')!;
    holder.replaceChildren();
    const frame = document.createElement('iframe');
    frame.title = '計測対象の製品';
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Product frame load failed'));
    });
    frame.src = import.meta.env.BASE_URL;
    const began = performance.now();
    holder.append(frame);
    holder.scrollIntoView({ block: 'start', behavior: 'instant' });
    await loaded;
    const target = frame.contentWindow!;
    const longTasks: number[] = [];
    // The observer belongs to the iframe's realm, not the benchmark page.
    const observe = target as Window & {
      PerformanceObserver: typeof PerformanceObserver;
    };
    const frameObserver = new observe.PerformanceObserver((list) => {
      longTasks.push(...list.getEntries().map((entry) => entry.duration));
    });
    frameObserver.observe({ type: 'longtask', buffered: true });
    try {
      while (
        !target.document.querySelector('#viewer canvas') ||
        target.document.querySelector('.viewer-message')
      ) {
        if (performance.now() - began > 20_000)
          throw new Error('Viewer ready timeout');
        await sleep(20);
      }
      await new Promise<void>((resolve) =>
        target.requestAnimationFrame(() =>
          target.requestAnimationFrame(() => resolve()),
        ),
      );
      const canvasReadyObservedMs = performance.now() - began;
      const nav = target.performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming;
      const resources = target.performance.getEntriesByType(
        'resource',
      ) as PerformanceResourceTiming[];
      await sleep(100);
      report.load = {
        domContentLoadedMs: nav.domContentLoadedEventEnd,
        loadMs: nav.loadEventEnd,
        paint: target.performance
          .getEntriesByType('paint')
          .map((entry) => ({ name: entry.name, startTimeMs: entry.startTime })),
        canvasReadyObservedMs,
        longTaskCount: longTasks.length,
        maxLongTaskMs: Math.max(0, ...longTasks),
        resources: resources.map((entry) => ({
          name: entry.name.split('/').at(-1),
          durationMs: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
      };
    } finally {
      frameObserver.disconnect();
    }
  });
};

buttons[2]!.onclick = () => {
  void run(async () => {
    const holder = document.querySelector<HTMLDivElement>('#product-frame')!;
    holder.replaceChildren();
    const frame = document.createElement('iframe');
    frame.title = '画面外の3D読み込みを確認する製品';
    frame.style.width = '390px';
    frame.style.height = '844px';
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Product frame load failed'));
    });
    frame.src = import.meta.env.BASE_URL;
    holder.append(frame);
    holder.scrollIntoView({ block: 'start', behavior: 'instant' });
    await loaded;
    const target = frame.contentWindow!;
    // load may precede React's first commit.
    const mountBegan = performance.now();
    while (!target.document.querySelector('#viewer')) {
      if (performance.now() - mountBegan > 20_000)
        throw new Error('Product mount timeout');
      await sleep(20);
    }
    const viewer = target.document.querySelector<HTMLElement>('#viewer')!;
    const observations = () => ({
      viewportWidth: target.innerWidth,
      viewportHeight: target.innerHeight,
      viewerTop: viewer.getBoundingClientRect().top,
      canvasCount: viewer.querySelectorAll('canvas').length,
      resources: (
        target.performance.getEntriesByType(
          'resource',
        ) as PerformanceResourceTiming[]
      ).map((entry) => ({
        name: entry.name.split('/').at(-1),
        decodedBodySize: entry.decodedBodySize,
      })),
    });
    // Asset request presence is the primary evidence, not this arbitrary delay.
    await sleep(1000);
    const beforeScroll = observations();
    const began = performance.now();
    viewer.scrollIntoView({ block: 'center', behavior: 'instant' });
    while (
      !viewer.querySelector('canvas') ||
      target.document.querySelector('.viewer-message')
    ) {
      if (performance.now() - began > 20_000)
        throw new Error('Offscreen viewer ready timeout');
      await sleep(20);
    }
    report.offscreen = {
      beforeScroll,
      afterScroll: observations(),
      scrollToCanvasObservedMs: performance.now() - began,
      note: '390x844 iframe in desktop Chrome, uncontrolled cache; not a mobile device or GPU completion',
    };
  });
};

buttons[3]!.onclick = () => {
  void run(async () => {
    const holder = document.querySelector<HTMLDivElement>('#product-frame')!;
    holder.replaceChildren();
    const frame = document.createElement('iframe');
    frame.title = '計算中の描画を計測する製品';
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Product frame load failed'));
    });
    frame.src = import.meta.env.BASE_URL;
    holder.append(frame);
    holder.scrollIntoView({ block: 'start', behavior: 'instant' });
    await loaded;
    const target = frame.contentWindow! as Window & typeof globalThis;
    const began = performance.now();
    while (!target.document.querySelector('#viewer canvas')) {
      target.document.querySelector('#viewer')?.scrollIntoView({
        block: 'center',
        behavior: 'instant',
      });
      if (performance.now() - began > 20_000)
        throw new Error('Viewer ready timeout');
      await sleep(20);
    }
    // Deliberately invoked with the iframe input as receiver below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(
      target.HTMLInputElement.prototype,
      'value',
    )!.set!;
    for (const [id, value] of [
      ['widthMm', '600'],
      ['depthMm', '800'],
      ['heightMm', '1200'],
    ]) {
      const input = target.document.getElementById(id!)!;
      setter.call(input, value);
      input.dispatchEvent(new target.Event('input', { bubbles: true }));
    }
    await sleep(300);
    const prototype = target.WebGL2RenderingContext.prototype;
    // Retain the originals for restoration; wrappers invoke .apply(this).
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const elements = prototype.drawElements;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const arrays = prototype.drawArrays;
    let drawCalls = 0;
    prototype.drawElements = function (...args) {
      drawCalls++;
      elements.apply(this, args);
    };
    prototype.drawArrays = function (...args) {
      drawCalls++;
      arrays.apply(this, args);
    };
    try {
      const form = target.document.querySelector<HTMLFormElement>('form')!;
      form.requestSubmit();
      await sleep(300);
      const cancel = [...target.document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === '計算を中止',
      );
      if (!cancel || cancel.disabled)
        throw new Error('Calculation did not start');
      drawCalls = 0;
      const observationBegan = performance.now();
      await sleep(2000);
      const observedCalls = drawCalls;
      const observationMs = performance.now() - observationBegan;
      cancel.click();
      await sleep(100);
      report.updates = {
        observationMs,
        drawCallsWhileCalculating: observedCalls,
        stopped: target.document.querySelector('#calculation-result')
          ?.textContent,
        note: 'Actual product, stationary visible canvas, 600x800x1200/margin10; draw calls wrapped during 2s of calculation, no animation or camera changes',
      };
    } finally {
      prototype.drawElements = elements;
      prototype.drawArrays = arrays;
    }
  });
};

interface Sample {
  readonly input: InputSnapshot;
  readonly bootMs: number;
  readonly modelInitializationMs: number;
  readonly totalMs: number;
  readonly computeMs: number;
  readonly status: string;
  readonly nodesVisited: number;
  readonly clearance: PathFoundResult['clearance'] | null;
}
class CalculationSampleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function calculate(
  input: InputSnapshot,
): Promise<{ sample: Sample; path: PathFoundResult | null }> {
  return new Promise((resolve, reject) => {
    const began = performance.now();
    let bootAt = began,
      initializingAt = began,
      searchingAt = began;
    const client = new CalculationClient({
      runtime: createCalculationRuntime(),
      createWorker() {
        const port = createCalculationWorker();
        let handler: WorkerPort['onmessage'] = null;
        return {
          get onmessage() {
            return handler;
          },
          set onmessage(next) {
            handler = next;
            port.onmessage = next
              ? (event) => {
                  const message = event.data;
                  if (isRecord(message)) {
                    if (message.type === 'ready') bootAt = performance.now();
                    if (message.stage === 'initializing')
                      initializingAt = performance.now();
                    if (
                      message.stage === 'searching' &&
                      message.elapsedMs === 0
                    )
                      searchingAt = performance.now();
                  }
                  next(event);
                }
              : null;
          },
          get onerror() {
            return port.onerror;
          },
          set onerror(next) {
            port.onerror = next;
          },
          get onmessageerror() {
            return port.onmessageerror;
          },
          set onmessageerror(next) {
            port.onmessageerror = next;
          },
          postMessage: (message) => port.postMessage(message),
          terminate: () => port.terminate(),
        };
      },
    });
    client.subscribe((state) => {
      if (state.status === 'failed') {
        client.dispose();
        reject(new CalculationSampleError(state.code, state.message));
      }
      if (state.status !== 'result') return;
      const result = state.message.result;
      const sample: Sample = {
        input,
        bootMs: bootAt - began,
        modelInitializationMs: searchingAt - initializingAt,
        totalMs: performance.now() - began,
        computeMs: result.elapsedMs,
        status: result.status === 'path-found' ? result.status : result.reason,
        nodesVisited: result.nodesVisited,
        clearance: result.status === 'path-found' ? result.clearance : null,
      };
      client.dispose();
      resolve({ sample, path: result.status === 'path-found' ? result : null });
    });
    client.calculate(input, {
      seed: 20260930,
      maxNodes: 5000,
      maxTimeMs: 15_000,
    });
  });
}

buttons[1]!.onclick = () => {
  void run(async () => {
    // Remove the product iframe so its WebGL context does not skew this sample.
    document.querySelector('#product-frame')!.replaceChildren();
    const cases: InputSnapshot[] = [
      { widthMm: 120, depthMm: 180, heightMm: 140, marginMm: 10 },
      { widthMm: 1000, depthMm: 300, heightMm: 200, marginMm: 10 },
    ];
    const samples: Sample[][] = [];
    report.runtime = samples;
    let path: PathFoundResult | null = null;
    for (const input of cases) {
      const group: Sample[] = [];
      samples.push(group);
      for (let index = 0; index < 6; index++) {
        const result = await calculate(input);
        group.push(result.sample);
        path ??= result.path;
        show();
      }
    }
    report.boundedSearch = (
      await calculate({
        widthMm: 600,
        depthMm: 800,
        heightMm: 1200,
        marginMm: 10,
      })
    ).sample;
    const container = document.querySelector<HTMLDivElement>(
      '#performance-viewer',
    )!;
    container.scrollIntoView({ block: 'center' });
    const frames: ViewerFrameMetrics[] = [];
    const importBegan = performance.now();
    const { createRouteViewer } = await import('../viewer/create-route-viewer');
    const importMs = performance.now() - importBegan;
    const initBegan = performance.now();
    const viewer = createRouteViewer(
      container,
      () => {
        report.contextLost = true;
      },
      undefined,
      undefined,
      (frame) => frames.push(frame),
    );
    const initializationMs = performance.now() - initBegan;
    try {
      const validated = validateInputSnapshot(cases[0]!);
      if (!validated.ok || !path) throw new Error('Reference path missing');
      viewer.setContent({ dimensions: validated.value, path });
      await sleep(500);
      frames.length = 0;
      await sleep(1000);
      const idleFrames = frames.length;
      frames.length = 0;
      viewer.setPlaying(true);
      await sleep(3000);
      viewer.setPlaying(false);
      const playback = [...frames];
      const intervals = playback
        .slice(1)
        .map((frame, index) => frame.timeMs - playback[index]!.timeMs);
      report.viewer = {
        importMs,
        initializationMs,
        idleFramesInOneSecond: idleFrames,
        playbackFrames: playback.length,
        meanFps:
          intervals.length /
          (intervals.reduce((sum, value) => sum + value, 0) / 1000),
        frameIntervalP95Ms: quantile(intervals, 0.95),
        renderCpuMedianMs: quantile(
          playback.map((frame) => frame.renderCpuMs),
          0.5,
        ),
        renderCpuP95Ms: quantile(
          playback.map((frame) => frame.renderCpuMs),
          0.95,
        ),
        lastFrame: playback.at(-1),
        hidden: document.hidden,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        note: 'RAF cadence and CPU submission only; not GPU duration or retained memory',
      };
    } finally {
      viewer.dispose();
    }
  });
};
buttons[4]!.onclick = () => {
  void run(async () => {
    document.querySelector('#product-frame')!.replaceChildren();
    const results: unknown[] = [];
    const matrix = {
      route: FIXED_ROUTE,
      options: { seed: 20260930, maxNodes: 5000, maxTimeMs: 15_000 },
      repetitions: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null as string | null,
      activeCase: null as string | null,
      completed: 0,
      failed: 0,
      pathsFound: 0,
      clearanceEvaluated: 0,
      results,
    };
    report.furnitureSizes = matrix;
    for (const entry of FURNITURE_SIZE_CASES) {
      matrix.activeCase = entry.name;
      show();
      try {
        const result = await calculate(entry.input);
        results.push({ ...entry, ...result.sample });
        matrix.completed++;
        if (result.path) {
          matrix.pathsFound++;
          if (result.path.clearance) matrix.clearanceEvaluated++;
        }
      } catch (error) {
        matrix.failed++;
        results.push({
          ...entry,
          status: 'failed',
          code: error instanceof CalculationSampleError ? error.code : null,
          error: String(error),
        });
      }
      show();
    }
    matrix.activeCase = null;
    matrix.finishedAt = new Date().toISOString();
  });
};
show();
