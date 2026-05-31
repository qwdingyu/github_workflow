import { ref, nextTick } from 'vue'
import { fetchConfig } from '@/api'

const widgetId = ref<number | null>(null)
const modalWidgetId = ref<number | null>(null)
export const siteKey = ref('')

async function loadSiteKey() {
  try {
    const data = await fetchConfig()
    siteKey.value = data.config?.turnstile_site_key || ''
  } catch {
    // keep default
  }
}

function renderTurnstile(containerId: string): number | null {
  if (!siteKey.value || !window.turnstile) return null
  const el = document.getElementById(containerId)
  if (!el) return null
  const id = window.turnstile.render(el, {
    sitekey: siteKey.value,
    'callback': () => {},
  } as any)
  return id
}

loadSiteKey()

export function useTurnstile() {
  // ready is managed internally

  function getResponse(): string | null {
    return window.turnstile?.getResponse() ?? null
  }

  function reset() {
    if (widgetId.value != null) window.turnstile?.reset(widgetId.value)
    if (modalWidgetId.value != null) window.turnstile?.reset(modalWidgetId.value)
  }

  function renderPageTurnstile() {
    const id = renderTurnstile('turnstile-container')
    if (id != null) widgetId.value = id
  }

  function renderModalTurnstile() {
    const id = renderTurnstile('pay-turnstile')
    if (id != null) modalWidgetId.value = id
  }

  function resetModalTurnstile() {
    if (modalWidgetId.value != null) {
      window.turnstile?.reset(modalWidgetId.value)
      modalWidgetId.value = null
    }
    // Re-render after DOM is ready
    nextTick(() => renderModalTurnstile())
  }

  return {
    getResponse,
    reset,
    renderPageTurnstile,
    renderModalTurnstile,
    resetModalTurnstile,
  }
}
