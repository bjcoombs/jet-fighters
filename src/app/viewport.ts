// Keeping a canvas's backing store matched to the pixels it is shown at.
//
// The page draws at the device's real resolution and has to notice when that
// changes under it.

/**
 * Ceiling on the effective device pixel ratio.
 *
 * The backing store costs memory as the square of this, and a pinched-in phone
 * can ask for a lot of it. Eight is past the point where any of the tube's
 * structure is still gaining detail.
 */
export const MAX_PIXEL_RATIO = 8;

/**
 * The resolution the tube should be drawn at, in backing-store pixels per CSS
 * pixel.
 *
 * `devicePixelRatio` covers the display's own density and browser zoom - a zoom
 * step raises it, which is why zooming the page already hands the renderer more
 * real pixels. It does **not** cover pinch zoom: the visual viewport magnifies
 * pixels that have already been drawn, so on a phone a pinch makes the tube
 * bigger and blurrier and nothing tells the canvas about it. `visualViewport
 * .scale` is that missing factor, and folding it in is what makes magnifying the
 * display on a touch device resolve the tube's structure rather than its
 * pixels.
 */
export function effectivePixelRatio(): number {
  const base = window.devicePixelRatio || 1;
  const pinch = window.visualViewport?.scale ?? 1;
  const combined = base * (Number.isFinite(pinch) && pinch > 0 ? pinch : 1);
  return Math.min(MAX_PIXEL_RATIO, combined);
}

/** Something that can be told its CSS size and pixel ratio. */
export interface Resizable {
  resize(cssWidth: number, cssHeight: number, dpr?: number): void;
}

/**
 * Keep `target`'s backing store matched to `canvas`'s CSS box.
 *
 * Sized to the box x {@link effectivePixelRatio}, now and on every viewport
 * resize, devicePixelRatio change (dragging the window between monitors, browser
 * zoom) or pinch, so the drawing stays crisp and uniformly scaled.
 */
export function attachCanvasSizing(canvas: HTMLCanvasElement, target: Resizable): void {
  let lastRatio = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  const applyCanvasSize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ratio = effectivePixelRatio();
    // Re-sizing a canvas clears it and rebuilds the mesh tile, and the visual
    // viewport fires continuously through a pinch. Only act on a real change.
    if (ratio === lastRatio && rect.width === lastWidth && rect.height === lastHeight) return;
    lastRatio = ratio;
    lastWidth = rect.width;
    lastHeight = rect.height;
    target.resize(rect.width, rect.height, ratio);
  };

  applyCanvasSize();
  window.addEventListener('resize', applyCanvasSize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applyCanvasSize).observe(canvas);
  }
  window.visualViewport?.addEventListener('resize', applyCanvasSize);
  watchDevicePixelRatio(applyCanvasSize);
}

/**
 * Invoke `onChange` whenever the devicePixelRatio changes. `matchMedia` fires
 * once per transition, so the listener re-arms itself against the new ratio -
 * this catches monitor-to-monitor drags and browser-zoom steps that the
 * `resize` event alone can miss.
 */
export function watchDevicePixelRatio(onChange: () => void): void {
  if (typeof window.matchMedia !== 'function') return;
  const arm = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`);
    media.addEventListener(
      'change',
      () => {
        onChange();
        arm();
      },
      { once: true },
    );
  };
  arm();
}
