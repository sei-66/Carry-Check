import { useEffect, useState } from 'react';
import type { DesignTheme, ThemePreference } from '@/shared/appearance';

export type { DesignTheme, ThemePreference } from '@/shared/appearance';

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem('carrycheck-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function readDesign(): DesignTheme {
  try {
    const saved = localStorage.getItem('carrycheck-design');
    return saved === 'pop' ? 'pop' : 'dot';
  } catch {
    return 'dot';
  }
}

export function useAppearance() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [design, setDesign] = useState<DesignTheme>(readDesign);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const theme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const onDark = () => setSystemDark(dark.matches);
    const onMotion = () => setReducedMotion(motion.matches);
    dark.addEventListener('change', onDark);
    motion.addEventListener('change', onMotion);
    return () => {
      dark.removeEventListener('change', onDark);
      motion.removeEventListener('change', onMotion);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('carrycheck-theme', preference);
    } catch {
      // The selected theme still works when browser storage is unavailable.
    }
  }, [preference, theme]);
  useEffect(() => {
    document.documentElement.dataset.design = design;
    try {
      localStorage.setItem('carrycheck-design', design);
    } catch {
      // Switching designs still works for this session without storage.
    }
  }, [design]);
  return { preference, setPreference, design, setDesign, theme, reducedMotion };
}
