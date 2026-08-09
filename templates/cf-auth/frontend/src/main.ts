/**
 * Admin SPA 入口。
 * 样式：base tokens + kit admin primitives；i18n 仅服务 kit 组件文案。
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './assets/base.css'
import './assets/admin.css'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.mount('#app')
