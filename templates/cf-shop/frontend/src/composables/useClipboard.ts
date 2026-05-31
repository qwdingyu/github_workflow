/** 剪贴板工具：一键复制文本到剪贴板，带按钮视觉反馈 */

const FEEDBACK_MS = 1500

/** 复制文本，更新按钮文字反馈 */
export function copyText(text: string, e: Event) {
  navigator.clipboard.writeText(text).then(() => {
    feedback(e, '✅')
  }).catch(() => {
    feedback(e, '❌')
  })
}

function feedback(e: Event, icon: string) {
  const btn = e.currentTarget as HTMLButtonElement
  const original = btn.textContent
  btn.textContent = icon
  setTimeout(() => { btn.textContent = original }, FEEDBACK_MS)
}
