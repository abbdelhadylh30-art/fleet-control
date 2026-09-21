"use client";

// Animated count-up number (L4 split out of the old monolith page.tsx).

import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    const start = performance.now();
    const dur = from === value ? 0 : 650;
    let raf = 0;
    const tick = (now: number) => {
      const p = dur === 0 ? 1 : Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className} aria-label={`${value}`}>
      {display}
    </span>
  );
}
