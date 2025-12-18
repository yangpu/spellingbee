/**
 * 豆包 TTS Edge Function
 * 通过 Supabase Edge Function 调用火山引擎语音合成 API
 * 支持 Storage 缓存，减少 API 调用
 * 
 * 部署命令：
 * supabase functions deploy doubao-tts --project-ref ctsxrhgjvkeyokaejwqb
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 火山引擎 TTS API 配置
const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v1/tts';
const TTS_BUCKET = 'tts-cache';

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
  return `ai/doubao/${language}/${voiceId}/${textHash}.mp3`;
}

interface TTSRequest {
  text: string;
  language: 'en' | 'zh';
  voiceId: string;
  rate?: number;
  volume?: number;
  appId: string;
  token: string;
  cluster?: string;
}

Deno.serve(async (req: Request) => {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: TTSRequest = await req.json();
    const { text, language, voiceId, rate = 1.0, volume = 1.0, appId, token, cluster } = body;

    if (!text || !appId || !token) {
      return new Response(
        JSON.stringify({ error: '缺少必要参数: text, appId, token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 初始化 Supabase 客户端（使用 service role key 访问 Storage）
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 生成缓存路径
    const cachePath = getCachePath(language, voiceId, text);

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

    // 第二步：缓存未命中，调用火山引擎 TTS API
    const reqid = crypto.randomUUID();
    
    // 确定 cluster（业务集群）
    // 默认使用 volcano_tts，如果用户指定了则使用用户指定的
    const ttsCluster = cluster || 'volcano_tts';

    const requestBody = {
      app: {
        appid: appId,
        token: 'placeholder', // 实际鉴权通过 Authorization 头
        cluster: ttsCluster,
      },
      user: {
        uid: 'spellingbee-user',
      },
      audio: {
        voice_type: voiceId,
        encoding: 'mp3',
        rate: 24000,
        speed_ratio: rate,
        volume_ratio: volume,
        pitch_ratio: 1.0,
      },
      request: {
        reqid: reqid,
        text: text,
        text_type: 'plain',
        operation: 'query',
      },
    };

    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer;${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('火山引擎 API 错误:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `火山引擎 TTS API 错误: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const responseData = await response.json();

    // 检查响应状态
    if (responseData.code !== 3000) {
      console.error('火山引擎业务错误:', responseData);
      return new Response(
        JSON.stringify({ 
          error: '火山引擎 TTS 业务错误', 
          code: responseData.code,
          message: responseData.message || '未知错误'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 解码 base64 音频数据
    const audioBase64 = responseData.data;
    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: '火山引擎 TTS 返回数据中没有音频' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Base64 解码
    const binaryString = atob(audioBase64);
    const audioData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioData[i] = binaryString.charCodeAt(i);
    }

    // 第三步：异步保存到 Storage 缓存（不阻塞响应）
    supabase.storage
      .from(TTS_BUCKET)
      .upload(cachePath, audioData, {
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
    return new Response(audioData, {
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
