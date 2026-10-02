// Prints every FIXED line the coach machine can speak, as JSON, built from the same task data
// and helpers the app uses (so the text matches exactly). Used by server/render_voice.py.
//   bun scripts/voice-lines.ts
import { tasks } from '../src/data'
import { gerund } from '../src/coach/machine'

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const lines = new Set<string>()
for (const t of tasks()) {
  lines.add(`${t.label}. Start by ${gerund(t.steps[0].text)}.`)
  t.steps.forEach((s, i) => {
    if (i > 0) {
      lines.add(`Good. Now ${lower(s.text)}.`)
      lines.add(`That’s it. Now ${lower(s.text)}.`)
    }
    // rehearsal checker (M key) speaks the step's common_mistake, else this fallback
    lines.add(s.common_mistake ?? `That doesn't look like "${s.text}" yet.`)
  })
}
lines.add('That’s the whole task. Nice work.')
console.log(JSON.stringify([...lines], null, 1))
