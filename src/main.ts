import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css'
import router from './router'
import App from './App.vue'
import './styles/main.scss'

// 在应用挂载前初始化主题（避免闪烁）
const THEME_KEY = 'spellingbee_theme'
const savedTheme = localStorage.getItem(THEME_KEY)
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme)
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(TDesign)
app.mount('#app')
