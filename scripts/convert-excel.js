/**
 * Excel 词库转换脚本
 * 用法: node scripts/convert-excel.js <excel文件名> <分类名>
 * 例如: node scripts/convert-excel.js grade3-400 grade3
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取命令行参数
const args = process.argv.slice(2);
const fileName = args[0] || 'grade3-400';
const category = args[1] || 'grade3';
const difficulty = parseInt(args[2]) || 2;

console.log(`\n📚 词库转换工具`);
console.log(`================`);
console.log(`文件: ${fileName}.xlsx`);
console.log(`分类: ${category}`);
console.log(`默认难度: ${difficulty}\n`);

// 读取 Excel 文件
const excelPath = path.join(__dirname, `../words/${fileName}.xlsx`);

if (!fs.existsSync(excelPath)) {
  console.error(`❌ 错误: 找不到文件 ${excelPath}`);
  process.exit(1);
}

const workbook = XLSX.readFile(excelPath);

console.log('工作表列表:', workbook.SheetNames);

// 获取第一个工作表
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// 转换为 JSON
const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('总行数:', rawData.length);

// 分析数据结构 - 检查所有非空的第一列
let wordRows = [];
for (let i = 0; i < rawData.length; i++) {
  const row = rawData[i];
  if (row && row[0] && typeof row[0] === 'string' && row[0].trim() !== '' && row[0] !== 'Word') {
    wordRows.push({ index: i, word: row[0] });
  }
}
console.log('包含单词的行数:', wordRows.length);

// 解析单词数据
const words = [];

for (let i = 0; i < wordRows.length; i++) {
  const rowInfo = wordRows[i];
  const rowIndex = rowInfo.index;
  const row1 = rawData[rowIndex];
  const row2 = rawData[rowIndex + 1];
  
  const word = row1[0]?.toString().trim();
  const pronunciation = row1[1]?.toString().trim() || '';
  const definition = row1[2]?.toString().trim() || '';
  const partOfSpeech = row2?.[1]?.toString().trim() || '';
  const exampleSentence = row2?.[2]?.toString().trim() || '';
  
  if (word) {
    words.push({
      id: crypto.randomUUID(),
      word: word,
      pronunciation: pronunciation,
      definition: definition,
      part_of_speech: partOfSpeech,
      example_sentence: exampleSentence,
      difficulty: difficulty,
      category: category
    });
  }
}

console.log(`\n✅ 成功解析 ${words.length} 个单词`);

// 输出示例
console.log('\n📝 前5个单词示例:');
words.slice(0, 5).forEach((w, i) => {
  console.log(`${i + 1}. ${w.word}`);
  console.log(`   发音: ${w.pronunciation}`);
  console.log(`   词性: ${w.part_of_speech}`);
  console.log(`   释义: ${w.definition.substring(0, 60)}${w.definition.length > 60 ? '...' : ''}`);
  console.log('');
});

// 生成 JSON 文件
const outputPath = path.join(__dirname, `../public/words/${fileName}.json`);

// 确保目录存在
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 写入 JSON 文件
fs.writeFileSync(outputPath, JSON.stringify(words, null, 2), 'utf-8');
console.log(`\n💾 JSON 文件已保存到: ${outputPath}`);
console.log(`\n🎉 转换完成！`);
