/**
 * A Babylon backend bound to a canvas.
 *
 * The mirror image of `createCanvasBackend` in the three adapter, and it makes
 * the same three decisions for the same reasons:
 *
 *   alpha              broadcast graphics composite over live video
 *   preserveDrawingBuffer  the confidence strip and every thumbnail read the
 *                      canvas back, and a buffer that does not survive the
 *                      frame reads as black
 *   pixel ratio 1      the preview must agree with the programme feed; a 2x
 *                      retina buffer would make them disagree
 */
import { Engine } from "@babylonjs/core/Engines/engine";

import { BabylonMirrorBackend } from "./babylon-backend";

export interface BabylonCanvasOptions {
  readonly antialias?: boolean;
  readonly maxBytes?: number;
}

export function createBabylonCanvasBackend(
  canvas: HTMLCanvasElement,
  options: BabylonCanvasOptions = {},
): BabylonMirrorBackend {
  const engine = new Engine(canvas, options.antialias ?? false, {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
    // The canvas belongs to whoever created it — MirrorBackend C2. Babylon
    // would otherwise resize it to the CSS box on every observed change.
    adaptToDeviceRatio: false,
  });
  engine.setHardwareScalingLevel(1);

  return new BabylonMirrorBackend({
    engine,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}
