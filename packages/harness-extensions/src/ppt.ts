import { createRequire } from 'node:module'
import type PptxType from 'pptxgenjs'
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as typeof PptxType.default

export const styles = ['minimal', 'business', 'course'] as const
export type Style = typeof styles[number]
export interface Draft { title: string; style: Style; enabled: boolean; slides: { title: string; bullets: string[] }[] }
function bounded(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Invalid presentation text')
  return value.trim()
}
export function validateDraft(input: unknown): Draft {
  if (!input || typeof input !== 'object') throw new Error('Invalid draft')
  const value = input as Record<string, unknown>
  if (!styles.includes(value.style as Style) || typeof value.enabled !== 'boolean' || !Array.isArray(value.slides) || value.slides.length < 1 || value.slides.length > 12) throw new Error('Invalid presentation configuration')
  return { title: bounded(value.title, 160), style: value.style as Style, enabled: value.enabled, slides: value.slides.map(item => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.bullets) || item.bullets.length > 8) throw new Error('Invalid slide')
    return { title: bounded(item.title, 160), bullets: item.bullets.map((bullet: unknown) => bounded(bullet, 500)) }
  }) }
}
export async function exportPptx(input: unknown): Promise<Buffer> {
  const draft = validateDraft(input)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = draft.title
  pptx.author = 'Fluxyard'
  pptx.subject = 'User-edited outline export'
  const accent = { minimal: '334155', business: '2563EB', course: '15803D' }[draft.style]
  draft.slides.forEach((content, index) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: accent }, line: { color: accent } })
    slide.addText(content.title, { x: 0.7, y: 0.55, w: 11.8, h: 1, fontFace: 'Arial', fontSize: 30, bold: true, color: accent, breakLine: false, fit: 'shrink' })
    if (content.bullets.length) slide.addText(content.bullets.map(text => ({ text, options: { bullet: true, breakLine: true } })), { x: 0.85, y: 1.9, w: 11.5, h: 4.5, fontFace: 'Arial', fontSize: 22, color: '334155', paraSpaceAfter: 16, fit: 'shrink' })
    slide.addText(`${index + 1} / ${draft.slides.length}`, { x: 11.8, y: 7, w: 0.8, h: 0.2, fontSize: 10, color: '64748B' })
  })
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as Buffer)
}
