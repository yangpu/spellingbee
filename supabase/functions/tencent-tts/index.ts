/**
 * 腾讯云 TTS Edge Function
 * 通过 Supabase Edge Function 调用腾讯云语音合成 API
 * 支持 Storage 缓存，减少 API 调用
 * 
 * 部署命令：
 * supabase functions deploy tencent-tts --project-ref ctsxrhgjvkeyokaejwqb
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 腾讯云 TTS API 配置
const TTS_ENDPOINT = 'https://tts.cloud.tencent.com/stream';
const TTS_BUCKET = 'tts-cache';

// 生成 HMAC-SHA1 签名
async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataData = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// 构建签名字符串 - 按照腾讯云文档要求
function buildSignatureString(params: Record<string, string | number>): string {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
  return `POSTtts.cloud.tencent.com/stream?${paramStr}`;
}

// 简单的字符串 hash 函数
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// 生成缓存路径
function getCachePath(language: string, voiceId: string, text: string): string {
  const textHash = hashString(text);
  return `online/tencent/${language}/${voiceId}/${textHash}.mp3`;
}

// 音色映射
const VOICE_TYPE_MAP: Record<string, number> = {
  '101001': 101001, // 智瑜
  '101002': 101002, // 智聆
  '101003': 101003, // 智美
  '101004': 101004, // 智云
  '101050': 101050, // WeJack
  '101051': 101051, // WeRose
};

interface TTSRequest {
  text: string;
  language: 'en' | 'zh';
  voiceId?: string;
  rate?: number;
  volume?: number;
  secretId: string;
  secretKey: string;
  appId: number;
}

Deno.serve(async (req: Request) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: TTSRequest = await req.json();
    const { text, language, voiceId, rate = 0, volume = 5, secretId, secretKey, appId } = body;

    if (!text || !secretId || !secretKey || !appId) {
      return new Response(
        JSON.stringify({ error: '缺少必要参数: text, secretId, secretKey, appId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 确定音色
    let voiceType = language === 'en' ? 101051 : 101001;
    if (voiceId && VOICE_TYPE_MAP[voiceId]) {
      voiceType = VOICE_TYPE_MAP[voiceId];
    }
    const actualVoiceId = voiceId || voiceType.toString();

    // 初始化 Supabase 客户端（使用 service role key 访问 Storage）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 生成缓存路径
    const cachePath = getCachePath(language, actualVoiceId, text);

    // 第一步：检查 Storage 缓存
    const { data: cachedData, error: downloadError } = await supabase.storage
      .from(TTS_BUCKET)
      .download(cachePath);

    if (!downloadError && cachedData) {
      // 缓存命中，直接返回
      const audioBuffer = await cachedData.arrayBuffer();
      return new Response(audioBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/octet-stream',
          'X-Audio-Type': 'audio/mpeg',
          'X-Cache': 'HIT',
        },
      });
    }

    // 第二步：缓存未命中，调用腾讯云 API
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400;
    const sessionId = crypto.randomUUID().replace(/-/g, '');

    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudio',
      AppId: appId,
      Codec: 'mp3',
      Expired: expired,
      ModelType: 1,
      PrimaryLanguage: language === 'en' ? 2 : 1,
      ProjectId: 0,
      SampleRate: 16000,
      SecretId: secretId,
      SessionId: sessionId,
      Speed: rate,
      Text: text,
      Timestamp: timestamp,
      VoiceType: voiceType,
      Volume: volume,
    };

    const signatureString = buildSignatureString(params);
    const signature = await hmacSha1(secretKey, signatureString);

    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': signature,
      },
      body: JSON.stringify(params),
    });

    const responseData = await response.arrayBuffer();
    
    // 检查是否是错误响应
    const textDecoder = new TextDecoder();
    const responseText = textDecoder.decode(responseData);
    
    if (responseText.startsWith('{')) {
      console.error('腾讯云返回错误:', responseText);
      try {
        const errorJson = JSON.parse(responseText);
        return new Response(
          JSON.stringify({ error: '腾讯云 TTS 业务错误', details: errorJson }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch {
        return new Response(
          JSON.stringify({ error: '腾讯云 TTS 返回未知错误', raw: responseText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 第三步：异步保存到 Storage 缓存（不阻塞响应）
    supabase.storage
      .from(TTS_BUCKET)
      .upload(cachePath, responseData, {
        contentType: 'audio/mpeg',
        cacheControl: '31536000',
        upsert: true,
      })
      .then(({ error }) => {
        if (error) {
          console.error('保存缓存失败:', error.message);
        }
      });

    // 返回音频数据
    return new Response(responseData, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'X-Audio-Type': 'audio/mpeg',
        'X-Cache': 'MISS',
      },
    });

  } catch (error) {
    console.error('Edge Function 错误:', error);
    return new Response(
      JSON.stringify({ error: '服务器内部错误', message: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
