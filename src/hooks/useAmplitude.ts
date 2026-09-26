import { useState, useEffect, useRef } from 'react';

/**
 * Reads an amplitude getter at ~15fps and returns the value as React state.
 * This isolates re-renders to only the components that actually display the amplitude,
 * preventing cascade re-renders up the context tree.
 */
export function useAmplitude(getter: () => number): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastTimeRef.current < 66) return; // ~15fps max
      lastTimeRef.current = now;

      const current = getter();
      if (Math.abs(current - lastRef.current) > 0.03) {
        lastRef.current = current;
        setValue(current);
      }
    };
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [getter]);

  return value;
}
