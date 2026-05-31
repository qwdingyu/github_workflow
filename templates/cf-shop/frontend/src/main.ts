import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/base.css'
import './assets/telegram.css'
import './assets/desktop.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
