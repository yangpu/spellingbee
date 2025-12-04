import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

// 创建一个简单的蜜蜂图标 SVG
const beeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#FFD700"/>
      <stop offset="100%" style="stop-color:#FFA500"/>
    </linearGradient>
  </defs>
  <!-- 背景圆 -->
  <circle cx="256" cy="256" r="240" fill="#FEF3C7"/>
  <!-- 身体 -->
  <ellipse cx="256" cy="280" rx="100" ry="120" fill="url(#bodyGrad)"/>
  <!-- 条纹 -->
  <rect x="156" y="220" width="200" height="25" fill="#1a1a1a" rx="12"/>
  <rect x="156" y="270" width="200" height="25" fill="#1a1a1a" rx="12"/>
  <rect x="156" y="320" width="200" height="25" fill="#1a1a1a" rx="12"/>
  <!-- 头部 -->
  <circle cx="256" cy="160" r="70" fill="url(#bodyGrad)"/>
  <!-- 眼睛 -->
  <circle cx="230" cy="150" r="20" fill="#1a1a1a"/>
  <circle cx="282" cy="150" r="20" fill="#1a1a1a"/>
  <circle cx="235" cy="145" r="7" fill="white"/>
  <circle cx="287" cy="145" r="7" fill="white"/>
  <!-- 触角 -->
  <path d="M220 100 Q200 60 180 50" stroke="#1a1a1a" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M292 100 Q312 60 332 50" stroke="#1a1a1a" stroke-width="8" fill="none" stroke-linecap="round"/>
  <circle cx="180" cy="50" r="10" fill="#1a1a1a"/>
  <circle cx="332" cy="50" r="10" fill="#1a1a1a"/>
  <!-- 翅膀 -->
  <ellipse cx="150" cy="220" rx="60" ry="80" fill="rgba(255,255,255,0.7)" stroke="#ddd" stroke-width="2"/>
  <ellipse cx="362" cy="220" rx="60" ry="80" fill="rgba(255,255,255,0.7)" stroke="#ddd" stroke-width="2"/>
  <!-- 微笑 -->
  <path d="M230 175 Q256 200 282 175" stroke="#1a1a1a" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>
`;

async function generateIcons() {
  const sizes = [192, 512];
  
  for (const size of sizes) {
    const outputPath = join(publicDir, `pwa-${size}x${size}.png`);
    
    await sharp(Buffer.from(beeSvg))
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`Generated: pwa-${size}x${size}.png`);
  }
  
  // 生成 apple-touch-icon
  await sharp(Buffer.from(beeSvg))
    .resize(180, 180)
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  
  console.log('Generated: apple-touch-icon.png');
  
  console.log('All PWA icons generated successfully!');
}

generateIcons().catch(console.error);
