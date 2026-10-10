import { describe, expect, it } from 'vitest'
import { workbenchBounds } from '../src/workbench-layout.ts'
describe('single-window workbench bounds', () => {
  it('fills the whole content area without a second navigation header', () => {
    expect(workbenchBounds(1240, 850)).toEqual({ x: 0, y: 0, width: 1240, height: 850 })
    expect(workbenchBounds(900, 640)).toEqual({ x: 0, y: 0, width: 900, height: 640 })
    expect(workbenchBounds(0, 30)).toEqual({ x: 0, y: 0, width: 0, height: 30 })
  })
})
