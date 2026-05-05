import { useEffect } from "react";
import Lenis from "lenis";

export function SmoothScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    // Skip on touch devices — native momentum scrolling feels better on mobile.
    const isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches;
    if (isTouch) return;

    const lenis = new Lenis({
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1,
      // Higher lerp = snappier response, less drift after the wheel stops.
      lerp: 0.18,
      syncTouch: false,
    });

    // When the user scrolls again mid-animation, snap closer to the target
    // so a "catch" feels immediate instead of fighting leftover inertia.
    const onWheel = () => {
      const target = (lenis as unknown as { targetScroll: number }).targetScroll;
      const actual = (lenis as unknown as { animatedScroll: number }).animatedScroll;
      if (Math.abs(target - actual) > 200) {
        lenis.scrollTo(target, { immediate: true });
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
}