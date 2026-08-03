import type { InjectionKey } from 'vue'
import type { Point } from '../lib/zoomMath'

export interface ZoomContext {
  /**
   * Normalized frame coordinates (0..1) to pixels in the player container,
   * with the current zoom and pan applied.
   *
   * Reads the zoom refs on every call, so calling it inside a `computed`
   * makes that computed track zoom, pan and container resizes.
   */
  project: (nx: number, ny: number) => Point
}

/**
 * Lives in its own module rather than in VideoPlayer.vue so the overlay can
 * import the key without importing the player, which would make the two
 * components import each other.
 */
export const ZOOM_CONTEXT: InjectionKey<ZoomContext> = Symbol('zoom-context')
