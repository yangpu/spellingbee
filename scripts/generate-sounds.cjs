/**
 * 生成可爱的小猫喵声和小狗汪汪声
 * 使用更复杂的音频合成算法模拟真实动物叫声
 */

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

// WAV 文件头生成函数
function createWavHeader(dataLength, sampleRate = SAMPLE_RATE, numChannels = 1, bitsPerSample = 16) {
  const buffer = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

// 将浮点样本转换为 16 位整数
function floatTo16Bit(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }
  return buffer;
}

// 保存为 WAV 文件
function saveWav(samples, filename) {
  const dataBuffer = floatTo16Bit(samples);
  const header = createWavHeader(dataBuffer.length);
  const wavBuffer = Buffer.concat([header, dataBuffer]);
  
  const outputPath = path.join(__dirname, '..', 'public', 'sounds', filename);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, wavBuffer);
  console.log(`Generated: ${outputPath}`);
}

// 生成带共振峰的声音（模拟声道共振）
function generateFormantSound(duration, f0Curve, formants, amplitude = 0.8) {
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);
  
  // 声门脉冲生成器状态
  let glottalPhase = 0;
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / numSamples;
    
    // 获取当前基频
    const f0 = f0Curve(progress, t);
    
    // 生成声门脉冲（使用 LF 模型简化版）
    glottalPhase += f0 / SAMPLE_RATE;
    if (glottalPhase >= 1) glottalPhase -= 1;
    
    // 声门波形：开相位 + 闭相位
    let glottal = 0;
    if (glottalPhase < 0.4) {
      // 开相位：正弦上升
      glottal = Math.sin(Math.PI * glottalPhase / 0.4);
    } else if (glottalPhase < 0.5) {
      // 快速下降
      glottal = Math.cos(Math.PI * (glottalPhase - 0.4) / 0.1) * 0.5 + 0.5;
      glottal = 1 - glottal;
    }
    
    // 应用共振峰滤波（简化的二阶谐振器叠加）
    let output = 0;
    for (const formant of formants) {
      const { freq, bandwidth, amp } = formant(progress);
      // 简化的共振峰：使用带通滤波近似
      const q = freq / bandwidth;
      const resonance = amp * Math.exp(-Math.PI * bandwidth * t % (1/f0)) * 
                        Math.sin(2 * Math.PI * freq * t);
      output += resonance * glottal;
    }
    
    // 添加一些气息噪声
    const breathNoise = (Math.random() * 2 - 1) * 0.05 * (1 - glottalPhase);
    
    samples[i] = (output + breathNoise) * amplitude;
  }
  
  return samples;
}

// 生成可爱的小猫喵声 - 欢快、高音调
function generateCuteMeow() {
  const duration = 0.55;
  const numSamples = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float32Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / numSamples;
    
    // 小猫的基频曲线：高音调，带有可爱的上扬
    // 起始 700Hz，上升到 1000Hz，再下降到 600Hz，最后小幅上扬到 750Hz
    let f0;
    if (progress < 0.15) {
      // 起音：快速上升（mee-）
      f0 = 700 + 300 * (progress / 0.15);
    } else if (progress < 0.4) {
      // 主体：保持高音（-ow）
      f0 = 1000 - 200 * ((progress - 0.15) / 0.25);
    } else if (progress < 0.75) {
      // 下降
      f0 = 800 - 250 * ((progress - 0.4) / 0.35);
    } else {
      // 可爱的小上扬结尾
      f0 = 550 + 200 * ((progress - 0.75) / 0.25);
    }
    
    // 添加轻微颤音（vibrato）让声音更生动
    const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 6 * t);
    f0 *= vibrato;
    
    // 声门脉冲相位
    const glottalPeriod = 1 / f0;
    const glottalPhase = (t % glottalPeriod) / glottalPeriod;
    
    // 声门波形
    let glottal = 0;
    if (glottalPhase < 0.35) {
      glottal = Math.sin(Math.PI * glottalPhase / 0.35);
    } else if (glottalPhase < 0.45) {
      glottal = Math.cos(Math.PI * (glottalPhase - 0.35) / 0.2);
    }
    
    // 小猫的共振峰（比成年猫更高）
    // F1: 800-1200Hz, F2: 1800-2500Hz, F3: 2800-3500Hz
    const f1 = 900 + 300 * Math.sin(Math.PI * progress);
    const f2 = 2000 + 500 * Math.sin(Math.PI * progress * 0.8);
    const f3 = 3000 + 400 * Math.sin(Math.PI * progress * 1.2);
    
    // 合成共振峰
    let output = 0;
    output += 1.0 * Math.sin(2 * Math.PI * f1 * t) * glottal;
    output += 0.7 * Math.sin(2 * Math.PI * f2 * t) * glottal;
    output += 0.4 * Math.sin(2 * Math.PI * f3 * t) * glottal;
    
    // 添加高频泛音（让声音更亮、更可爱）
    output += 0.2 * Math.sin(2 * Math.PI * f0 * 4 * t) * glottal;
    output += 0.1 * Math.sin(2 * Math.PI * f0 * 5 * t) * glottal;
    
    // 添加轻微的气息声
    const breath = (Math.random() * 2 - 1) * 0.03;
    
    // 包络
    let envelope = 1;
    if (progress < 0.05) {
      envelope = progress / 0.05; // 快速起音
    } else if (progress > 0.85) {
      envelope = (1 - progress) / 0.15; // 柔和收尾
    }
    
    // 添加一点音量波动，更自然
    envelope *= 1 + 0.1 * Math.sin(2 * Math.PI * 4 * t);
    
    samples[i] = (output * 0.4 + breath) * envelope * 0.8;
  }
  
  // 归一化
  let maxVal = 0;
  for (let i = 0; i < samples.length; i++) {
    maxVal = Math.max(maxVal, Math.abs(samples[i]));
  }
  if (maxVal > 0) {
    for (let i = 0; i < samples.length; i++) {
      samples[i] = samples[i] / maxVal * 0.85;
    }
  }
  
  return samples;
}

// 生成可爱的小狗汪汪声 - 两声短促的叫声
function generateCuteBark() {
  const barkDuration = 0.18;
  const pauseDuration = 0.08;
  const totalDuration = barkDuration * 2 + pauseDuration;
  const numSamples = Math.floor(SAMPLE_RATE * totalDuration);
  const samples = new Float32Array(numSamples);
  
  // 生成单声汪
  function generateSingleBark(startSample, pitch = 1.0) {
    const barkSamples = Math.floor(SAMPLE_RATE * barkDuration);
    
    for (let i = 0; i < barkSamples; i++) {
      const idx = startSample + i;
      if (idx >= numSamples) break;
      
      const t = i / SAMPLE_RATE;
      const progress = i / barkSamples;
      
      // 小狗的基频：比大狗高，更可爱
      // 起始快速上升，然后下降
      let f0;
      if (progress < 0.1) {
        // 快速起音
        f0 = 300 + 200 * (progress / 0.1);
      } else if (progress < 0.3) {
        // 保持
        f0 = 500;
      } else {
        // 下降
        f0 = 500 - 150 * ((progress - 0.3) / 0.7);
      }
      f0 *= pitch;
      
      // 声门脉冲
      const glottalPeriod = 1 / f0;
      const glottalPhase = (t % glottalPeriod) / glottalPeriod;
      
      // 狗叫的声门波形更粗犷
      let glottal = 0;
      if (glottalPhase < 0.3) {
        glottal = Math.sin(Math.PI * glottalPhase / 0.3);
      } else if (glottalPhase < 0.5) {
        glottal = Math.cos(Math.PI * (glottalPhase - 0.3) / 0.4);
      }
      
      // 小狗的共振峰（比大狗高）
      // F1: 600-900Hz, F2: 1200-1800Hz, F3: 2200-2800Hz
      const f1 = 700 + 200 * (1 - progress);
      const f2 = 1500 + 300 * (1 - progress);
      const f3 = 2500 + 200 * (1 - progress);
      
      // 合成
      let output = 0;
      output += 1.0 * Math.sin(2 * Math.PI * f1 * t) * glottal;
      output += 0.6 * Math.sin(2 * Math.PI * f2 * t) * glottal;
      output += 0.3 * Math.sin(2 * Math.PI * f3 * t) * glottal;
      
      // 狗叫的特征：更多低频谐波
      output += 0.5 * Math.sin(2 * Math.PI * f0 * t) * glottal;
      output += 0.3 * Math.sin(2 * Math.PI * f0 * 2 * t) * glottal;
      
      // 添加一些噪声（狗叫有更多气息声）
      const noise = (Math.random() * 2 - 1) * 0.08 * (1 - progress * 0.5);
      
      // 包络：快速起音，较快衰减
      let envelope = 1;
      if (progress < 0.05) {
        envelope = progress / 0.05;
      } else if (progress > 0.6) {
        envelope = Math.pow((1 - progress) / 0.4, 1.5);
      }
      
      samples[idx] += (output * 0.35 + noise) * envelope * 0.9;
    }
  }
  
  // 第一声汪（稍高音调）
  generateSingleBark(0, 1.1);
  
  // 第二声汪（正常音调）
  const secondBarkStart = Math.floor(SAMPLE_RATE * (barkDuration + pauseDuration));
  generateSingleBark(secondBarkStart, 1.0);
  
  // 归一化
  let maxVal = 0;
  for (let i = 0; i < samples.length; i++) {
    maxVal = Math.max(maxVal, Math.abs(samples[i]));
  }
  if (maxVal > 0) {
    for (let i = 0; i < samples.length; i++) {
      samples[i] = samples[i] / maxVal * 0.85;
    }
  }
  
  return samples;
}

// 添加混响效果（让声音更自然）
function addReverb(samples, decay = 0.3, delayMs = 30) {
  const delaySamples = Math.floor(SAMPLE_RATE * delayMs / 1000);
  const output = new Float32Array(samples.length);
  
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i];
    if (i >= delaySamples) {
      output[i] += samples[i - delaySamples] * decay;
    }
    if (i >= delaySamples * 2) {
      output[i] += samples[i - delaySamples * 2] * decay * 0.5;
    }
  }
  
  // 归一化
  let maxVal = 0;
  for (let i = 0; i < output.length; i++) {
    maxVal = Math.max(maxVal, Math.abs(output[i]));
  }
  if (maxVal > 0.9) {
    for (let i = 0; i < output.length; i++) {
      output[i] = output[i] / maxVal * 0.85;
    }
  }
  
  return output;
}

// 主程序
console.log('Generating cute animal sounds...');

// 生成可爱的喵叫声
console.log('Generating meow...');
let meowSamples = generateCuteMeow();
meowSamples = addReverb(meowSamples, 0.2, 25);
saveWav(meowSamples, 'meow.wav');

// 生成可爱的汪汪声
console.log('Generating bark...');
let barkSamples = generateCuteBark();
barkSamples = addReverb(barkSamples, 0.15, 20);
saveWav(barkSamples, 'bark.wav');

console.log('Done! Generated cute meow and bark sounds.');
