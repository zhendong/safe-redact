import { useRef, useCallback, useEffect } from 'react';

interface PinchZoomOptions {
  minScale: number;
  maxScale: number;
  onZoomChange: (scale: number) => void;
  enabled?: boolean;
}

export function usePinchZoom({ minScale, maxScale, onZoomChange, enabled = true }: PinchZoomOptions) {
  const initialDistance = useRef<number>(0);
  const initialScale = useRef<number>(1);

  const getDistance = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled || e.touches.length !== 2) {
      return;
    }

    e.preventDefault();
    initialDistance.current = getDistance(e.touches[0], e.touches[1]);
  }, [enabled, getDistance]);

  const handleTouchMove = useCallback((e: React.TouchEvent, currentScale: number) => {
    if (!enabled || e.touches.length !== 2) {
      return;
    }

    e.preventDefault();

    const currentDistance = getDistance(e.touches[0], e.touches[1]);

    if (initialDistance.current === 0) {
      initialDistance.current = currentDistance;
      initialScale.current = currentScale;
      return;
    }

    const scaleMultiplier = currentDistance / initialDistance.current;
    const newScale = Math.min(Math.max(initialScale.current * scaleMultiplier, minScale), maxScale);

    onZoomChange(newScale);
  }, [enabled, getDistance, minScale, maxScale, onZoomChange]);

  const handleTouchEnd = useCallback((e: React.TouchEvent, currentScale: number) => {
    if (!enabled) {
      return;
    }

    if (e.touches.length < 2) {
      initialDistance.current = 0;
      initialScale.current = currentScale;
    }
  }, [enabled]);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
