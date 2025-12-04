const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/words/grade3-400.json');
const words = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

words.forEach(word => {
  if (word.word === "center/\ncentre") {
    word.definition_cn = "中心；中央";
    console.log("✓ center/centre: 中心；中央");
  }
  if (word.word === "labor/\nlabour") {
    word.definition_cn = "劳动；劳工；分娩";
    console.log("✓ labor/labour: 劳动；劳工；分娩");
  }
});

fs.writeFileSync(filePath, JSON.stringify(words, null, 2), 'utf-8');
console.log("\n完成！");
