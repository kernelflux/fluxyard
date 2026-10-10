export const WORKBENCH_HEADER_HEIGHT = 0
export function workbenchBounds(width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: WORKBENCH_HEADER_HEIGHT, width: Math.max(0, width), height: Math.max(0, height - WORKBENCH_HEADER_HEIGHT) }
}
