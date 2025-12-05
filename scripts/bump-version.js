#!/usr/bin/env node

/**
 * 自动递增 package.json 的 patch 版本号
 * 例如：1.3.6 -> 1.3.7
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJsonPath = join(__dirname, '..', 'package.json');

try {
  // 读取 package.json
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  // 解析当前版本
  const version = packageJson.version;
  const versionParts = version.split('.');
  
  if (versionParts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  // 递增 patch 版本
  const major = parseInt(versionParts[0], 10);
  const minor = parseInt(versionParts[1], 10);
  const patch = parseInt(versionParts[2], 10);
  
  const newVersion = `${major}.${minor}.${patch + 1}`;
  
  // 更新版本号
  packageJson.version = newVersion;
  
  // 写回文件（保持格式）
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  
  console.log(`✅ Version bumped: ${version} -> ${newVersion}`);
} catch (error) {
  console.error('❌ Failed to bump version:', error.message);
  process.exit(1);
}
