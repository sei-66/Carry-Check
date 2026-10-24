import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalculationClient,
  type CalculationState,
} from '@/application/calculation-client';
import type { InputSnapshot } from '@/domain/dimensions';
import {
  createCalculationRuntime,
  createCalculationWorker,
} from './create-calculation-worker';

export const CALCULATION_OPTIONS = {
  seed: 20260930,
  maxNodes: 5000,
  maxTimeMs: 15000,
} as const;

export function useCalculation() {
  const client = useRef<CalculationClient | null>(null);
  const startedAt = useRef(0);
  const [state, setState] = useState<CalculationState>({ status: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const busy = state.status === 'initializing' || state.status === 'running';

  useEffect(() => {
    const instance = new CalculationClient({
      createWorker: createCalculationWorker,
      runtime: createCalculationRuntime(),
    });
    client.current = instance;
    const unsubscribe = instance.subscribe(setState);
    return () => {
      unsubscribe();
      instance.dispose();
      client.current = null;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(
      () => setElapsedMs(performance.now() - startedAt.current),
      100,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const calculate = useCallback((input: InputSnapshot) => {
    startedAt.current = performance.now();
    setElapsedMs(0);
    client.current?.calculate(input, CALCULATION_OPTIONS);
  }, []);
  const cancel = useCallback(() => client.current?.cancel(), []);
  const invalidate = useCallback(() => client.current?.invalidateInput(), []);
  return { state, busy, elapsedMs, calculate, cancel, invalidate };
}
