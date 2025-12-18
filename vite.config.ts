import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const isProduction = process.env.NODE_ENV === 'production'
const base = isProduction ? '/spellingbee/' : '/'

// 读取 package.json 获取版本号
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['bee.svg', 'apple-touch-icon.png', 'words/*.json'],
      manifest: {
        name: 'Spelling Bee - 单词拼写大赛',
        short_name: 'Spelling Bee',
        description: '一款帮助学习英语单词拼写的应用',
        theme_color: '#f59e0b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
        navigateFallback: isProduction ? '/spellingbee/index.html' : '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        // 禁用 workbox 的日志
        disableDevLogs: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/words\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'word-lists-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\.(png|svg|ico|webmanifest)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase API 缓存 - 挑战赛列表（使用 StaleWhileRevalidate 策略）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/challenges.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-challenges-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 10 // 10 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase API 缓存 - 词典列表（使用 StaleWhileRevalidate 策略）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/dictionaries.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-dictionaries-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 30 // 30 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase API 缓存 - 词典单词（使用 StaleWhileRevalidate 策略）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/dictionary_words.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-dictionary-words-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase Storage 缓存 - 头像和封面图片（CacheFirst，长期缓存）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // TTS 语音缓存 - Supabase Storage 中的音频文件（CacheFirst，长期缓存）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/tts-cache\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tts-audio-cache',
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase API 缓存 - 其他 REST API（profiles 等）
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true, // 开发模式下启用 PWA 以测试缓存
        type: 'module',
        navigateFallback: 'index.html'
      },
      // 禁用 workbox 的 verbose 和 debug 日志
      injectRegister: 'auto',
      selfDestroying: false
    })
  ],
  base,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: ''
      }
    }
  }
})
