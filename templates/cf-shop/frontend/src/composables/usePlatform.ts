import { ref, computed, onMounted } from 'vue'
import type { Platform } from '@/types'

const platform = ref<Platform>('h5-desktop')
const isTelegram = computed(() => platform.value.startsWith('telegram'))
const isMobile = computed(() => platform.value.includes('mobile'))
const isDesktop = computed(() => platform.value.includes('desktop'))

function detect() {
  const isTg = !!(window as any).Telegram?.WebApp
  const ua = navigator.userAgent
  const isMobileUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)

  if (isTg) {
    platform.value = isMobileUA ? 'telegram-mobile' : 'telegram-desktop'
  } else {
    platform.value = isMobileUA ? 'h5-mobile' : 'h5-desktop'
  }
}

onMounted(detect)

export function usePlatform() {
  return { platform, isTelegram, isMobile, isDesktop }
}
