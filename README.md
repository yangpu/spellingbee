# 🐝 Spelling Bee - 单词拼写大赛模拟器

一个基于 Vue3 + TDesign 的单词拼写学习与比赛模拟应用，帮助你记忆单词、提升拼写能力。

![Vue3](https://img.shields.io/badge/Vue-3.4-4FC08D?style=flat-square&logo=vue.js)
![TDesign](https://img.shields.io/badge/TDesign-1.8-0052CC?style=flat-square)
![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?style=flat-square&logo=vite)

## ✨ 功能特色

### 🎤 比赛模拟
- **虚拟发音官**：使用浏览器语音合成技术，清晰朗读每个单词
- **限时答题**：每个单词 60 秒（可调）答题时间，模拟真实比赛
- **提问功能**：可询问单词的发音、释义、词性和例句
- **即时评分**：根据难度和剩余时间计算得分

### 📚 单词学习
- **卡片学习**：翻转卡片查看单词详情
- **键盘快捷键**：Space 翻转、← 复习、→ 掌握
- **进度追踪**：标记已掌握/待复习的单词

### 📊 词库管理
- **内置词库**：包含 30 个常用单词（可扩展）
- **导入导出**：支持 JSON 格式的单词表
- **分类筛选**：按难度和类别筛选单词

### 📈 学习统计
- **成绩记录**：记录每次比赛的得分和正确率
- **成就系统**：解锁各种学习成就徽章
- **历史回顾**：查看错题列表，针对性复习

## 🏆 比赛规则

基于 Spelling Bee 官方规则：

1. **口语拼写**：选手不允许使用任何工具或材料
2. **限时答题**：每位选手答题时间为一分钟
3. **允许提问**：可向发音官提问单词的发音、定义、词性和例句
4. **重复发音**：拼读前应重复单词发音，清楚地逐一拼读每个字母
5. **零容错**：作答时如出现字母拼错，则直接淘汰

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

## 🔧 配置 Supabase（可选）

如果需要云端存储和用户认证功能：

1. 创建 [Supabase](https://supabase.com) 项目
2. 复制环境变量配置：

```bash
cp .env.example .env
```

3. 在 `.env` 中填入你的 Supabase 配置：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. 在 Supabase 中创建数据表（SQL 参考 `src/lib/supabase.js`）

## 📁 项目结构

```
spellingbee/
├── public/
│   └── bee.svg              # 应用图标
├── src/
│   ├── lib/
│   │   └── supabase.js      # Supabase 客户端配置
│   ├── router/
│   │   └── index.js         # 路由配置
│   ├── stores/
│   │   ├── auth.js          # 用户认证状态
│   │   ├── words.js         # 单词数据管理
│   │   └── competition.js   # 比赛状态管理
│   ├── styles/
│   │   └── main.scss        # 全局样式
│   ├── views/
│   │   ├── Home.vue         # 首页
│   │   ├── Learn.vue        # 学习页面
│   │   ├── Competition.vue  # 比赛页面
│   │   ├── Words.vue        # 词库管理
│   │   └── Stats.vue        # 统计页面
│   ├── App.vue              # 根组件
│   └── main.js              # 入口文件
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## 📝 单词数据格式

导入单词时使用以下 JSON 格式：

```json
[
  {
    "word": "example",
    "pronunciation": "/ɪɡˈzæmpəl/",
    "definition": "a thing characteristic of its kind",
    "part_of_speech": "noun",
    "example_sentence": "This is an example sentence.",
    "difficulty": 3,
    "category": "basic"
  }
]
```

字段说明：
- `word`: 单词（必填）
- `pronunciation`: 音标
- `definition`: 释义（必填）
- `part_of_speech`: 词性（noun, verb, adjective 等）
- `example_sentence`: 例句
- `difficulty`: 难度 1-5
- `category`: 分类

## 🎨 技术栈

- **框架**: Vue 3 (Composition API)
- **UI 组件**: TDesign Vue Next
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **构建工具**: Vite 5
- **样式**: SCSS
- **数据库**: Supabase (可选)
- **语音合成**: Web Speech API

## 📱 浏览器支持

- Chrome 80+
- Firefox 80+
- Safari 14+
- Edge 80+

> 注意：语音合成功能需要浏览器支持 Web Speech API

## 📄 License

MIT License

