import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import mammoth from "mammoth";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import { runGeminiCookiesRule3, checkCookieLivePlaywright } from "./automation.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable large JSON payloads for uploading multiple SRT files
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Global memory stores for files, logs, history, and active jobs
const activeFiles = new Map<string, any>();
const systemLogs: any[] = [];
const translationHistory: any[] = [];
let globalCredentials: any[] = [];

// Helper to write safe system logs
function addLog(level: 'info' | 'warning' | 'error' | 'success', message: string) {
  const timestamp = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const log = {
    id: Math.random().toString(36).substring(7),
    timestamp,
    level,
    message,
  };
  systemLogs.push(log);
  // Cap logs at 1000 items
  if (systemLogs.length > 1000) {
    systemLogs.shift();
  }
}

// Subtitle block interface
interface SRTBlock {
  index: string;
  timeline: string;
  text: string;
}

// Robust SRT parser
function parseSRT(content: string): SRTBlock[] {
  const blocks: SRTBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const pattern = /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*?)(?=\n\n|\n\s*\n|$)/g;
  
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    blocks.push({
      index: match[1].trim(),
      timeline: match[2].trim(),
      text: match[3].trim().replace(/\n/g, ' ')
    });
  }
  
  if (blocks.length === 0) {
    // Fallback line-by-line simple parse in case of different formatting
    const lines = normalized.split('\n');
    let currentIndex = "";
    let currentTimeline = "";
    let currentTextLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^\d+$/.test(line)) {
        if (currentIndex && currentTimeline) {
          blocks.push({
            index: currentIndex,
            timeline: currentTimeline,
            text: currentTextLines.join(' ')
          });
        }
        currentIndex = line;
        currentTextLines = [];
      } else if (line.includes('-->')) {
        currentTimeline = line;
      } else if (line !== '') {
        currentTextLines.push(line);
      }
    }
    if (currentIndex && currentTimeline) {
      blocks.push({
        index: currentIndex,
        timeline: currentTimeline,
        text: currentTextLines.join(' ')
      });
    }
  }
  
  return blocks;
}

// Formatter to convert blocks back into SRT string
function compileSRT(blocks: SRTBlock[]): string {
  return blocks.map(b => `${b.index}\n${b.timeline}\n${b.text}`).join('\n\n') + '\n';
}

// Post-processing function to clean, reindex and format SRT outputs perfectly
function reindexAndCleanSRT(srtContent: string): string {
  if (!srtContent) return "";
  
  // Clean markdown block wrappers if present
  let cleanContent = srtContent.replace(/```[a-zA-Z]*\n/g, "").replace(/```/g, "").trim();
  
  // Clean up any accidental '[QUY TẮC 4]', '[QUY TẮC 5]', or similar header at the very beginning
  cleanContent = cleanContent.replace(/^\[QUY\s+TẮC\s+(4|5)\]\s*/i, "").trim();
  
  const blocks: SRTBlock[] = [];
  const normalized = cleanContent.replace(/\r\n/g, '\n').trim();
  
  // Match SRT block: index, timeline, and multi-line text
  const pattern = /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*?)(?=\n\n|\n\s*\n|$)/g;
  
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    blocks.push({
      index: match[1].trim(),
      timeline: match[2].trim(),
      text: match[3].trim().replace(/\n/g, ' ')
    });
  }
  
  // Fallback if the pattern matching didn't yield anything (formatting variant)
  if (blocks.length === 0) {
    const lines = normalized.split('\n');
    let currentIndex = "";
    let currentTimeline = "";
    let currentTextLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^\d+$/.test(line)) {
        if (currentIndex && currentTimeline) {
          blocks.push({
            index: currentIndex,
            timeline: currentTimeline,
            text: currentTextLines.join(' ')
          });
        }
        currentIndex = line;
        currentTextLines = [];
      } else if (line.includes('-->')) {
        currentTimeline = line;
      } else if (line !== '') {
        currentTextLines.push(line);
      }
    }
    if (currentIndex && currentTimeline) {
      blocks.push({
        index: currentIndex,
        timeline: currentTimeline,
        text: currentTextLines.join(' ')
      });
    }
  }

  // Re-index sequentially from 1 and apply character whitelist cleaning
  // Whitelist: \p{L} (letters), \p{N} (digits), \s (spaces), and , . ? ! : ; ' " “ ” ‘ ’ ( ) -
  return blocks.map((b, index) => {
    let text = b.text;
    let cleaned = text.replace(/[^\p{L}\p{N}\s,.\?!:;'"“”‘’()\-]/gu, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return `${index + 1}\n${b.timeline}\n${cleaned}`;
  }).join('\n\n') + '\n';
}

function getNextDay3PMVietnam(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = fmt.formatToParts(now);
  const partMap = new Map(parts.map(p => [p.type, p.value]));
  
  const vnYear = parseInt(partMap.get('year') || '2026', 10);
  const vnMonth = parseInt(partMap.get('month') || '1', 10) - 1; // 0-indexed
  const vnDay = parseInt(partMap.get('day') || '1', 10);
  
  // Tomorrow at 15:00 local Vietnam time is 08:00 UTC (since Vietnam is UTC+7)
  const tomorrow3PM_UTC = Date.UTC(vnYear, vnMonth, vnDay + 1, 8, 0, 0, 0);
  return tomorrow3PM_UTC;
}

// --- RUNTIME API KEY POOL STATE & LOCK MANAGER ---
interface RuntimeApiKey {
  id: string;
  email: string;
  api_key: string;
  keyOrCookie: string; // alias for backwards compatibility
  status: 'LIVE' | 'IN_USE' | 'COOLING' | 'DEAD' | 'EXHAUSTED';
  cooldown_until?: number; // timestamp
  retry_lethal_count: number;
  last_used_timestamp: number;
  request_timestamps?: number[];
  total_requests_count?: number;
  requests_2_5_flash_count?: number;
  requests_3_5_flash_count?: number;
  requests_since_cooling?: number;
  cooling_threshold?: number;
  quota_reset_at?: number;
}

type RuntimeCookie = RuntimeApiKey; // Type alias for ease of integration

class ApiKeyPool {
  private static keys: RuntimeApiKey[] = [];
  private static exhaustedMemory = new Map<string, {
    status: 'EXHAUSTED';
    cooldown_until: number;
    total_requests_count: number;
    requests_2_5_flash_count?: number;
    requests_3_5_flash_count?: number;
    quota_reset_at: number;
  }>();

  public static initialize(providedCredentials: any[]) {
    // Store current exhausted keys to memory before they get overridden or deleted
    for (const key of this.keys) {
      if (key.status === 'EXHAUSTED' && key.cooldown_until && Date.now() < key.cooldown_until) {
        this.exhaustedMemory.set(key.api_key, {
          status: 'EXHAUSTED',
          cooldown_until: key.cooldown_until,
          total_requests_count: key.total_requests_count || 40,
          requests_2_5_flash_count: key.requests_2_5_flash_count || 0,
          requests_3_5_flash_count: key.requests_3_5_flash_count || 0,
          quota_reset_at: key.quota_reset_at || getNextDay3PMVietnam()
        });
      }
    }

    const existingMap = new Map<string, RuntimeApiKey>();
    for (const k of this.keys) {
      existingMap.set(k.api_key, k);
    }

    const newKeys: RuntimeApiKey[] = [];

    if (providedCredentials && providedCredentials.length > 0) {
      for (const cred of providedCredentials) {
        const rawKey = cred.api_key || cred.keyOrCookie || "";
        const key = rawKey.trim();
        if (!key) continue;

        const existing = existingMap.get(key);
        const memoryEntry = this.exhaustedMemory.get(key);
        const now = Date.now();
        const isStillMemoryExhausted = memoryEntry && memoryEntry.cooldown_until && now < memoryEntry.cooldown_until;

        // Normalize status
        let incomingStatus = (cred.status || '').toUpperCase();
        let finalStatus: 'LIVE' | 'IN_USE' | 'COOLING' | 'DEAD' | 'EXHAUSTED' = 'LIVE';
        if (incomingStatus === 'LIVE' || incomingStatus === 'IN_USE' || incomingStatus === 'COOLING' || incomingStatus === 'DEAD' || incomingStatus === 'EXHAUSTED') {
          finalStatus = incomingStatus as any;
        } else if (incomingStatus === 'DIE' || incomingStatus === 'DEAD') {
          finalStatus = 'DEAD';
        } else {
          finalStatus = (existing?.status) || 'LIVE';
        }

        if (isStillMemoryExhausted) {
          finalStatus = 'EXHAUSTED';
        }

        if (isStillMemoryExhausted && (!existing || existing.status !== 'EXHAUSTED')) {
          addLog('warning', `[Khôi phục bộ nhớ] API Key ${cred.email || `Key ...${key.slice(-4)}`} đã được tự động đưa về trạng thái EXHAUSTED do bộ nhớ lưu trữ phiên trước đó.`);
        }

        if (finalStatus === 'EXHAUSTED') {
          const cooldown_val = cred.cooldown_until || existing?.cooldown_until || (isStillMemoryExhausted ? memoryEntry.cooldown_until : getNextDay3PMVietnam());
          const quota_reset_val = cred.quota_reset_at || existing?.quota_reset_at || (isStillMemoryExhausted ? memoryEntry.quota_reset_at : getNextDay3PMVietnam());
          const req_count_val = existing?.total_requests_count || cred.total_requests_count || (isStillMemoryExhausted ? memoryEntry.total_requests_count : 40);
          const req_2_5_val = existing?.requests_2_5_flash_count || cred.requests_2_5_flash_count || (isStillMemoryExhausted ? memoryEntry.requests_2_5_flash_count : 0);
          const req_3_5_val = existing?.requests_3_5_flash_count || cred.requests_3_5_flash_count || (isStillMemoryExhausted ? memoryEntry.requests_3_5_flash_count : 0);
          this.exhaustedMemory.set(key, {
            status: 'EXHAUSTED',
            cooldown_until: cooldown_val,
            total_requests_count: req_count_val,
            requests_2_5_flash_count: req_2_5_val,
            requests_3_5_flash_count: req_3_5_val,
            quota_reset_at: quota_reset_val
          });
        }

        newKeys.push({
          id: cred.id || existing?.id || Math.random().toString(36).substring(7),
          email: cred.email || existing?.email || `Key ...${key.slice(-4)}`,
          api_key: key,
          keyOrCookie: key,
          status: finalStatus,
          cooldown_until: cred.cooldown_until || existing?.cooldown_until || (isStillMemoryExhausted ? memoryEntry.cooldown_until : undefined),
          retry_lethal_count: existing?.retry_lethal_count || 0,
          last_used_timestamp: existing?.last_used_timestamp || 0,
          request_timestamps: existing?.request_timestamps || [],
          total_requests_count: existing?.total_requests_count || (isStillMemoryExhausted ? memoryEntry.total_requests_count : 0),
          requests_2_5_flash_count: existing?.requests_2_5_flash_count || cred.requests_2_5_flash_count || (isStillMemoryExhausted ? memoryEntry.requests_2_5_flash_count : 0),
          requests_3_5_flash_count: existing?.requests_3_5_flash_count || cred.requests_3_5_flash_count || (isStillMemoryExhausted ? memoryEntry.requests_3_5_flash_count : 0),
          requests_since_cooling: existing?.requests_since_cooling || 0,
          cooling_threshold: existing?.cooling_threshold || (Math.floor(Math.random() * 51) + 50),
          quota_reset_at: cred.quota_reset_at || existing?.quota_reset_at || (isStillMemoryExhausted ? memoryEntry.quota_reset_at : undefined)
        });
      }
    }

    // Fallback to system key if no custom keys exist
    if (newKeys.length === 0) {
      const sysKey = (process.env.GEMINI_API_KEY || "").trim();
      if (sysKey) {
        const existing = existingMap.get(sysKey);
        const memoryEntry = this.exhaustedMemory.get(sysKey);
        const now = Date.now();
        const isStillMemoryExhausted = memoryEntry && memoryEntry.cooldown_until && now < memoryEntry.cooldown_until;

        newKeys.push({
          id: 'system_default',
          email: 'System Default API Key',
          api_key: sysKey,
          keyOrCookie: sysKey,
          status: isStillMemoryExhausted ? 'EXHAUSTED' : (existing?.status || 'LIVE'),
          cooldown_until: existing?.cooldown_until || (isStillMemoryExhausted ? memoryEntry.cooldown_until : undefined),
          retry_lethal_count: existing?.retry_lethal_count || 0,
          last_used_timestamp: existing?.last_used_timestamp || 0,
          request_timestamps: existing?.request_timestamps || [],
          total_requests_count: existing?.total_requests_count || (isStillMemoryExhausted ? memoryEntry.total_requests_count : 0),
          requests_2_5_flash_count: existing?.requests_2_5_flash_count || 0,
          requests_3_5_flash_count: existing?.requests_3_5_flash_count || 0,
          requests_since_cooling: existing?.requests_since_cooling || 0,
          cooling_threshold: existing?.cooling_threshold || (Math.floor(Math.random() * 51) + 50),
          quota_reset_at: existing?.quota_reset_at || (isStillMemoryExhausted ? memoryEntry.quota_reset_at : undefined)
        });
      }
    }

    this.keys = newKeys;
    this.syncGlobalCredentials();
  }

  public static syncGlobalCredentials() {
    globalCredentials = this.keys
      .filter(k => k.id !== 'system_default')
      .map(k => ({
        id: k.id,
        email: k.email,
        api_key: k.api_key,
        keyOrCookie: k.keyOrCookie,
        status: k.status,
        cooldown_until: k.cooldown_until,
        total_requests_count: k.total_requests_count,
        requests_2_5_flash_count: k.requests_2_5_flash_count || 0,
        requests_3_5_flash_count: k.requests_3_5_flash_count || 0,
        quota_reset_at: k.quota_reset_at
      }));
  }

  public static getKeys(): RuntimeApiKey[] {
    return this.keys;
  }

  // Periodic automatic rã đông (Defrost) check
  public static checkCoolingAndDefrost() {
    const now = Date.now();
    let changed = false;

    for (const key of this.keys) {
      // Khởi tạo thời gian reset nếu chưa có
      if (!key.quota_reset_at) {
        key.quota_reset_at = getNextDay3PMVietnam();
        changed = true;
      }

      // Kiểm tra xem đã qua chu kỳ reset 15h VN chưa
      if (now >= key.quota_reset_at) {
        key.total_requests_count = 0;
        key.requests_2_5_flash_count = 0;
        key.requests_3_5_flash_count = 0;
        key.requests_since_cooling = 0;
        key.quota_reset_at = getNextDay3PMVietnam();
        changed = true;

        if (key.status === 'EXHAUSTED') {
          key.status = 'LIVE';
          key.retry_lethal_count = 0;
          key.cooling_threshold = Math.floor(Math.random() * 51) + 50;
          delete key.cooldown_until;
          this.exhaustedMemory.delete(key.api_key);
          addLog('success', `[Đánh thức] API Key ${key.email} đã tự động khôi phục và reset số lượng yêu cầu hàng ngày khi sang chu kỳ mới (vào lúc 15h VN).`);
        } else {
          addLog('info', `[Chu kỳ mới] Đã tự động reset số lượng yêu cầu hàng ngày của API Key ${key.email} về 0.`);
        }
      }

      if (key.status === 'COOLING' && key.cooldown_until && now >= key.cooldown_until) {
        key.status = 'LIVE';
        key.retry_lethal_count = 0;
        key.requests_since_cooling = 0;
        key.cooling_threshold = Math.floor(Math.random() * 51) + 50; // New random 50-100 threshold
        delete key.cooldown_until;
        changed = true;
        addLog('success', `[Rã đông] API Key ${key.email} đã kết thúc thời gian nghỉ, khôi phục về LIVE (Ngưỡng quét spam mới: ${key.cooling_threshold} reqs).`);
      } else if (key.status === 'EXHAUSTED' && key.cooldown_until && now >= key.cooldown_until) {
        key.status = 'LIVE';
        key.retry_lethal_count = 0;
        key.requests_since_cooling = 0;
        key.total_requests_count = 0;
        key.requests_2_5_flash_count = 0;
        key.requests_3_5_flash_count = 0;
        key.cooling_threshold = Math.floor(Math.random() * 51) + 50;
        delete key.cooldown_until;
        this.exhaustedMemory.delete(key.api_key);
        changed = true;
        addLog('success', `[Đánh thức] API Key ${key.email} đã hết thời hạn đóng băng hàng ngày (vào lúc 15h VN), khôi phục về LIVE.`);
      }
    }

    if (changed) {
      this.syncGlobalCredentials();
    }
  }

  // Find the LIVE API Key with the oldest last_used_timestamp (circular rotation)
  public static acquireCookie(context: string): RuntimeApiKey | null {
    // Run defrost check
    this.checkCoolingAndDefrost();

    // Look for all LIVE keys
    const liveKeys = this.keys.filter(key => key.status === 'LIVE');
    if (liveKeys.length === 0) {
      return null;
    }

    // Pick the one with the minimum last_used_timestamp
    let bestKey = liveKeys[0];
    for (let i = 1; i < liveKeys.length; i++) {
      if (liveKeys[i].last_used_timestamp < bestKey.last_used_timestamp) {
        bestKey = liveKeys[i];
      }
    }

    bestKey.status = 'IN_USE';
    this.syncGlobalCredentials();
    return bestKey;
  }

  public static releaseCookie(keyId: string) {
    const key = this.keys.find(k => k.id === keyId);
    if (key) {
      if (key.status === 'IN_USE') {
        key.status = 'LIVE';
      }
      this.syncGlobalCredentials();
    }
  }

  // Re-export methods under same name for backwards compatibility with the pipeline runner
  public static releaseKey(keyId: string) {
    this.releaseCookie(keyId);
  }

  public static markAsDead(keyId: string) {
    const key = this.keys.find(k => k.id === keyId);
    if (key) {
      key.status = 'DEAD';
      this.syncGlobalCredentials();
    }
  }

  public static markAsCooling(keyId: string) {
    const key = this.keys.find(k => k.id === keyId);
    if (key) {
      key.status = 'COOLING';
      key.cooldown_until = Date.now() + 60000; // Quarantine 60s
      this.syncGlobalCredentials();
    }
  }

  public static markAsExhausted(keyId: string) {
    const key = this.keys.find(k => k.id === keyId);
    if (key) {
      key.status = 'EXHAUSTED';
      key.cooldown_until = getNextDay3PMVietnam();
      key.quota_reset_at = key.quota_reset_at || getNextDay3PMVietnam();
      this.exhaustedMemory.set(key.api_key, {
        status: 'EXHAUSTED',
        cooldown_until: key.cooldown_until,
        total_requests_count: key.total_requests_count || 40,
        requests_2_5_flash_count: key.requests_2_5_flash_count || 0,
        requests_3_5_flash_count: key.requests_3_5_flash_count || 0,
        quota_reset_at: key.quota_reset_at
      });
      this.syncGlobalCredentials();
      addLog('error', `[Đóng băng] API Key ${key.email} đã chạm giới hạn RequestsPerDay hoặc đạt hạn mức an toàn 20 yêu cầu/ngày cho mỗi Model. Tiến hành Freezing cho đến 15:00 chiều ngày hôm sau.`);
    }
  }
}

const CookiePool = ApiKeyPool;

async function acquireCookieWithWait(context: string): Promise<RuntimeCookie> {
  while (true) {
    const key = CookiePool.acquireCookie(context);
    if (key) {
      return key;
    }
    // Sleep 500ms before trying to acquire again
    await new Promise(r => setTimeout(r, 500));
  }
}

// Determine key status: LIVE, COOLING (rate limit / quota), or DEAD (invalid key / other fatal error)
async function validateKeyStatus(key: string): Promise<'LIVE' | 'COOLING' | 'EXHAUSTED' | 'DEAD'> {
  if (!key || !key.trim()) {
    addLog('error', `Kiểm tra thất bại: Key/Cookie trống rỗng.`);
    return 'DEAD';
  }
  try {
    const testAi = new GoogleGenAI({
      apiKey: key.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const resp = await testAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "ping",
    });
    if (resp && resp.text) {
      return 'LIVE';
    }
    return 'DEAD';
  } catch (err: any) {
    const errorMsg = err.message || err.toString() || 'Unknown error';
    const statusCode = err.status || err.statusCode || (err.response && err.response.status);
    
    const isRequestsPerDay = errorMsg.toLowerCase().includes('requestsperday') || errorMsg.toLowerCase().includes('requests per day');
    if (isRequestsPerDay) {
      addLog('error', `Kiểm tra khoá: Key đạt giới hạn quota ngày (RequestsPerDay). Tự động đưa vào trạng thái EXHAUSTED (Đóng băng đến 15:00 ngày hôm sau).`);
      return 'EXHAUSTED';
    }

    // Check for rate limit or quota exceeded
    const isQuotaExceeded = 
      statusCode === 429 || 
      errorMsg.toLowerCase().includes('quota') || 
      errorMsg.toLowerCase().includes('resource_exhausted') || 
      errorMsg.toLowerCase().includes('limit exceeded') ||
      errorMsg.toLowerCase().includes('resource exhausted') ||
      errorMsg.toLowerCase().includes('exhausted');

    if (isQuotaExceeded) {
      addLog('warning', `Kiểm tra khoá: Key đạt giới hạn quota (429 / Exhausted). Tự động đưa vào trạng thái COOLING.`);
      return 'COOLING';
    }

    addLog('error', `Kiểm tra khoá thất bại: ${errorMsg}`);
    return 'DEAD';
  }
}

// Check if a key/cookie is valid (LIVE or COOLING)
async function validateKey(key: string): Promise<boolean> {
  const status = await validateKeyStatus(key);
  return status === 'LIVE';
}

// Pipeline executor
async function executeTranslationPipeline(
  fileId: string,
  settings: {
    sourceLang: string;
    targetLang: string;
    chunkLine: number;
    chunkSession: number;
    threads: number;
    requestInterval?: number;
    wordsPerChunk?: number;
    wordTolerance?: number;
    dictionary?: string;
    useCookies?: boolean;
    cookiesGemini?: string;
    enableDeepThink?: boolean;
    rule45Model?: string;
    chromeProfilePath?: string;
    proxy?: string;
  }
) {
  const fileData = activeFiles.get(fileId);
  if (!fileData) return;

  fileData.status = 'translating';
  fileData.progress = 5;
  fileData.errorMsg = undefined;
  fileData.startTime = Date.now();
  fileData.endTime = undefined;
  fileData.totalPausedDuration = 0;
  fileData.pauseStartTime = undefined;
  fileData.elapsedTime = 0;
  
  const threadLimit = Math.min(10, Math.max(1, settings.threads || 3));
  fileData.threads = [];
  for (let t = 1; t <= threadLimit; t++) {
    fileData.threads.push({
      id: t,
      chunkIndex: -1,
      totalChunks: 0,
      apiKey: "Đang chờ...",
      status: "idle",
      lastUpdated: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
      label: t === 1 ? "Đang phân tích cú pháp..." : "Đang chờ..."
    });
  }
  activeFiles.set(fileId, fileData);

  // Helper to check control state (pause/stop) of the translation
  const checkControlState = async (): Promise<boolean> => {
    while (true) {
      const freshData = activeFiles.get(fileId);
      if (!freshData) {
        return true; // Stopped/deleted
      }
      if (freshData.status === 'stopped') {
        return true;
      }
      if (freshData.status === 'paused') {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return false; // Active/translating
    }
  };

  const updatePipelineThread = (threadId: number, status: 'idle' | 'processing' | 'paused' | 'stopped' | 'success' | 'error', chunkIdx: number, apiKeyEmail?: string, label?: string) => {
    const freshData = activeFiles.get(fileId);
    if (freshData && freshData.threads) {
      const th = freshData.threads.find((x: any) => x.id === threadId);
      if (th) {
        th.status = status;
        th.chunkIndex = chunkIdx;
        if (apiKeyEmail !== undefined) th.apiKey = apiKeyEmail;
        if (label !== undefined) th.label = label;
        th.lastUpdated = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        activeFiles.set(fileId, freshData);
      }
    }
  };

  addLog('info', `Starting pipeline for file: ${fileData.name} with ${settings.threads} threads.`);

  try {
    // --- STEP 1: PARSING ---
    addLog('info', `[Rule 1] Parsing SRT subtitles from "${fileData.name}"`);
    const srtBlocks = parseSRT(fileData.originalContent);
    fileData.blocks = srtBlocks;
    
    if (srtBlocks.length === 0) {
      throw new Error("No subtitle blocks found in file. Please ensure valid SRT format.");
    }

    const rawOriginalText = srtBlocks.map(b => b.text).join(' ');
    fileData.rawText = rawOriginalText;
    fileData.progress = 15;
    activeFiles.set(fileId, fileData);
    addLog('success', `[Rule 1] Parsed ${srtBlocks.length} subtitle lines.`);

    // --- STEP 2: GLOBAL DRAFT TRANSLATION ---
    addLog('info', `[Rule 2] Generating global draft translation in ${settings.targetLang}`);
    
    const rawChunks: string[] = [];
    const targetWords = settings.wordsPerChunk || 500;
    const tolerance = settings.wordTolerance || 50;
    const minWords = Math.max(1, targetWords - tolerance);
    const maxWords = targetWords + tolerance;

    addLog('info', `[Rule 2] Chunking subtitle by word count. Target: ${targetWords} words, Tolerance: ${tolerance} words.`);

    let blockIdx = 0;
    while (blockIdx < srtBlocks.length) {
      let currentChunkText = "";
      let currentWordCount = 0;
      let bestCutIdx = -1;
      let j = blockIdx;

      while (j < srtBlocks.length) {
        const blockText = srtBlocks[j].text;
        const blockWords = blockText.trim().split(/\s+/).filter(Boolean).length;

        currentChunkText += (currentChunkText ? " " : "") + blockText;
        currentWordCount += blockWords;

        // Check if block ends with a sentence terminator (. ? !)
        const endsSentence = /[.!?]['"]?\s*$/.test(blockText);

        if (endsSentence) {
          if (currentWordCount >= minWords && currentWordCount <= maxWords) {
            bestCutIdx = j;
            break;
          } else if (currentWordCount < minWords) {
            bestCutIdx = j; // potential cut point if nothing else is found within limits
          } else {
            // exceeded maximum words
            if (bestCutIdx === -1) {
              bestCutIdx = j;
            }
            break;
          }
        } else {
          if (currentWordCount > maxWords) {
            if (bestCutIdx === -1) {
              bestCutIdx = Math.max(blockIdx, j - 1);
            }
            break;
          }
        }
        j++;
      }

      if (bestCutIdx === -1) {
        bestCutIdx = srtBlocks.length - 1;
      }

      // Rebuild chunk text up to bestCutIdx
      let chunkText = "";
      for (let k = blockIdx; k <= bestCutIdx; k++) {
        chunkText += (chunkText ? " " : "") + srtBlocks[k].text;
      }
      
      if (chunkText.trim()) {
        rawChunks.push(chunkText.trim());
      }

      blockIdx = bestCutIdx + 1;
    }

    const draftResults: string[] = new Array(rawChunks.length).fill("");
    let draftChunkIdx = 0;

    function getNextDraftChunkIdx() {
      if (draftChunkIdx >= rawChunks.length) return -1;
      return draftChunkIdx++;
    }

    let activeDraftWorkers = threadLimit;

    await new Promise<void>((resolveDraft) => {
      let draftStopped = false;

      async function runDraftThread(threadId: number) {
        const updateDraftThreadState = (status: 'idle' | 'processing' | 'paused' | 'stopped' | 'success' | 'error', chunkIdx: number, apiKeyEmail?: string, label?: string) => {
          updatePipelineThread(threadId, status, chunkIdx, apiKeyEmail, label);
        };

        updateDraftThreadState("idle", -1, "Đang bốc API Key...", `[Rule 2] Khởi tạo...`);
        let keyItem;
        try {
          keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
        } catch (e) {
          addLog('error', `[Draft-Thread #${threadId}] Không bốc được API Key.`);
          activeDraftWorkers--;
          if (activeDraftWorkers <= 0) resolveDraft();
          return;
        }

        addLog('success', `[Draft-Thread #${threadId}] Ánh xạ độc quyền API Key: ${keyItem.email}`);
        updateDraftThreadState("idle", -1, keyItem.email, `[Rule 2] Sẵn sàng`);

        try {
          while (true) {
            if (await checkControlState()) {
              draftStopped = true;
              updateDraftThreadState("stopped", -1, keyItem.email, `[Rule 2] Bị dừng`);
              break;
            }

            const myIdx = getNextDraftChunkIdx();
            if (myIdx === -1) {
              break;
            }

            const portionLabel = `[Rule 2] Dịch nháp ${myIdx + 1}/${rawChunks.length}`;
            addLog('info', `[Draft-Thread #${threadId}] Đang dịch nháp portion ${myIdx + 1}/${rawChunks.length}...`);
            updateDraftThreadState("processing", myIdx, keyItem.email, portionLabel);

            let success = false;
            while (!success) {
              try {
                if (await checkControlState()) {
                  draftStopped = true;
                  updateDraftThreadState("stopped", -1, keyItem.email, `[Rule 2] Bị dừng`);
                  break;
                }

                const intervalMs = (settings.requestInterval !== undefined ? settings.requestInterval : 1) * 1000;
                const now = Date.now();
                const elapsed = now - keyItem.last_used_timestamp;
                const waitTime = intervalMs - elapsed;
                if (waitTime > 0) {
                  await new Promise(r => setTimeout(r, waitTime));
                }

                const aiInstance = new GoogleGenAI({
                  apiKey: keyItem.api_key,
                  httpOptions: {
                    headers: {
                      'User-Agent': 'aistudio-build',
                    }
                  }
                });

                const sysPrompt = `Bạn là nhà dịch thuật bản địa hóa xuất sắc. Hãy dịch đoạn văn bản gốc sau sang tiếng ${settings.targetLang}. Trả về bản dịch thô, tuyệt đối không thêm bình luận hay giải thích gì thêm.`;
                
                const response = await aiInstance.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: `Văn bản gốc:\n${rawChunks[myIdx]}`,
                  config: {
                    systemInstruction: sysPrompt,
                    temperature: 0.3,
                  }
                });

                draftResults[myIdx] = (response.text || "").trim();
                keyItem.last_used_timestamp = Date.now();
                keyItem.retry_lethal_count = 0;
                keyItem.requests_2_5_flash_count = (keyItem.requests_2_5_flash_count || 0) + 1;
                keyItem.total_requests_count = (keyItem.total_requests_count || 0) + 1;
                
                if (keyItem.requests_2_5_flash_count >= 20) {
                  addLog('error', `[Đóng băng an toàn] API Key ${keyItem.email} đã đạt hạn mức an toàn 20 yêu cầu/ngày cho Gemini 2.5 Flash. Tiến hành đóng băng (EXHAUSTED).`);
                  CookiePool.markAsExhausted(keyItem.id);
                }

                success = true;

                updateDraftThreadState("success", myIdx, keyItem.email, `[Rule 2] Xong nháp ${myIdx + 1}/${rawChunks.length}`);
                addLog('success', `[Draft-Thread #${threadId}] Đã xong nháp ${myIdx + 1}/${rawChunks.length}`);

                // Track and rotate key if it hits 5 reqs/min
                if (!keyItem.request_timestamps) {
                  keyItem.request_timestamps = [];
                }
                keyItem.request_timestamps.push(Date.now());
                const oneMinuteAgo = Date.now() - 60000;
                keyItem.request_timestamps = keyItem.request_timestamps.filter(t => t > oneMinuteAgo);

                if (keyItem.request_timestamps.length >= 5) {
                  addLog('warning', `[Draft-Thread #${threadId}] API Key ${keyItem.email} đã đạt 5 yêu cầu/phút. Tiến hành xoay key sang API key khác...`);
                  CookiePool.markAsCooling(keyItem.id);
                  keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                  addLog('success', `[Draft-Thread #${threadId}] Đã xoay sang API Key mới thành công: ${keyItem.email}`);
                  updateDraftThreadState("idle", -1, keyItem.email, `[Rule 2] Đã xoay key`);
                }

              } catch (err: any) {
                const is401 = err.status === 401 ||
                              (err.message && (
                                err.message.includes("401") ||
                                err.message.toLowerCase().includes("unauthorized") ||
                                err.message.toLowerCase().includes("invalid_api_key") ||
                                err.message.toLowerCase().includes("api key not valid") ||
                                err.message.toLowerCase().includes("expired")
                              ));

                const is429 = err.status === 429 ||
                              (err.message && (
                                err.message.includes("429") ||
                                err.message.toLowerCase().includes("quota") ||
                                err.message.toLowerCase().includes("too many requests") ||
                                err.message.toLowerCase().includes("resource_exhausted") ||
                                err.message.toLowerCase().includes("rate limit")
                              ));

                const is503 = err.status === 503 ||
                              (err.message && (
                                err.message.includes("503") ||
                                err.message.toLowerCase().includes("unavailable") ||
                                err.message.toLowerCase().includes("high demand") ||
                                err.message.toLowerCase().includes("temporary") ||
                                err.message.toLowerCase().includes("overloaded")
                              ));

                if (is401 || err.status === 403) {
                  addLog('error', `[Draft-Thread #${threadId}] Key ${keyItem.email} dính lỗi xác thực/vô hiệu hóa. Chuyển DEAD.`);
                  updateDraftThreadState("error", myIdx, `Lỗi Auth (DEAD): ${keyItem.email}`, portionLabel);
                  CookiePool.markAsDead(keyItem.id);
                  updateDraftThreadState("idle", -1, "Đang đổi Key mới...", portionLabel);
                  keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                } else if (is429) {
                  addLog('warning', `[Draft-Thread #${threadId}] Key ${keyItem.email} dính lỗi 429. Chuyển COOLING.`);
                  updateDraftThreadState("paused", myIdx, `Cooling (429): ${keyItem.email}`, portionLabel);
                  CookiePool.markAsCooling(keyItem.id);
                  updateDraftThreadState("idle", -1, "Đang đổi Key mới...", portionLabel);
                  keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                } else if (is503) {
                  addLog('warning', `[Draft-Thread #${threadId}] Key ${keyItem.email} dính lỗi 503. Chuyển COOLING.`);
                  updateDraftThreadState("paused", myIdx, `Cooling (503): ${keyItem.email}`, portionLabel);
                  CookiePool.markAsCooling(keyItem.id);
                  await new Promise(r => setTimeout(r, 5000));
                  updateDraftThreadState("idle", -1, "Đang đổi Key mới...", portionLabel);
                  keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                } else {
                  keyItem.retry_lethal_count += 1;
                  addLog('error', `[Draft-Thread #${threadId}] Key ${keyItem.email} lỗi hệ thống (${keyItem.retry_lethal_count}/3): ${err.message || err}`);
                  updateDraftThreadState("error", myIdx, `Lỗi (${keyItem.retry_lethal_count}/3): ${keyItem.email}`, portionLabel);
                  if (keyItem.retry_lethal_count >= 3) {
                    addLog('error', `[Draft-Thread #${threadId}] Chuyển DEAD.`);
                    CookiePool.markAsDead(keyItem.id);
                    updateDraftThreadState("idle", -1, "Đang đổi Key mới...", portionLabel);
                    keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                  } else {
                    CookiePool.releaseKey(keyItem.id);
                    await new Promise(r => setTimeout(r, 2000));
                    updateDraftThreadState("idle", -1, "Thử lại cùng Key...", portionLabel);
                    keyItem = await acquireCookieWithWait(`Draft-Thread-${threadId}`);
                  }
                }
              }
            }
          }
        } finally {
          CookiePool.releaseKey(keyItem.id);
          activeDraftWorkers--;
          if (activeDraftWorkers <= 0 || draftStopped) {
            resolveDraft();
          }
        }
      }

      for (let t = 1; t <= threadLimit; t++) {
        runDraftThread(t);
      }
    });

    if (await checkControlState()) {
      addLog('warning', `Dừng tiến trình dịch file "${fileData.name}" theo yêu cầu người dùng.`);
      return;
    }

    const draftTranslation = draftResults.filter(Boolean).join(" ");
    fileData.draftTranslation = draftTranslation.trim();
    fileData.progress = 35;
    activeFiles.set(fileId, fileData);
    addLog('success', `[Rule 2] Draft translation generated successfully.`);

    // --- STEP 3: CONTEXT BOOK & CHARACTER ANALYSIS ---
    if (await checkControlState()) {
      addLog('warning', `Dừng tiến trình dịch file "${fileData.name}" trước Bước 3 theo yêu cầu người dùng.`);
      return;
    }

    addLog('info', `[Rule 3] Building localization rules, role-mappings, and scene settings.`);
    for (let t = 1; t <= threadLimit; t++) {
      if (t === 1) {
        updatePipelineThread(1, 'idle', -1, "Đang bốc API Key...", '[Rule 3] Phân tích nhân vật & bối cảnh');
      } else {
        updatePipelineThread(t, 'idle', -1, "...", 'Đang chờ Thread 1 hoàn thành Bước 3...');
      }
    }
    
    let rule3Context = "";
    let rule3Success = false;

    if (settings.useCookies) {
      const modelName = settings.enableDeepThink !== false ? '3.1 Pro (Deep Think)' : '3.1 Pro (Đơn thuần)';
      addLog('info', `[Rule 3] Tiến hành phân tích bằng Cookies Gemini (Model ${modelName}) qua Playwright...`);
      updatePipelineThread(1, 'processing', -1, "Cookies Gemini Browser", '[Rule 3] Đang khởi động trình duyệt Playwright...');

      const dictPrompt = settings.dictionary && settings.dictionary.trim()
        ? `\n\nSử dụng bộ dictionary dưới đây làm dữ liệu tham chiếu CHÍNH XÁC NHẤT để dịch đúng các thuật ngữ, bối cảnh, tên nhân vật, danh xưng xưng hô và phong cách dịch:\n[BỘ DICTIONARY THAM KHẢO]\n${settings.dictionary.trim()}\n[HẾT BỘ DICTIONARY THAM KHẢO]\n`
        : "";

      const rule3SystemPrompt = `Bạn là một Đạo diễn kịch bản, Biên kịch xuất sắc và chuyên gia bản địa hóa phim chuyên nghiệp. 
Nhiệm vụ của bạn là đọc toàn bộ văn bản phụ đề gốc (Quy tắc 1) và bản dịch thô (Quy tắc 2), phân tích sâu sắc cốt truyện để đồng nhất bối cảnh, nhân vật, thuật ngữ, phong cách và nội dung câu chuyện.${dictPrompt}

Dựa vào sườn mẫu cực kỳ chi tiết dưới đây, hãy tự động phân tích và tạo ra Quy tắc 3 tương ứng cho THỂ LOẠI / STYLE của bộ phim hiện tại. Bạn phải phân tích cực kỳ kỹ lưỡng để phát hiện ra các lỗi nhận diện giọng nói (STT - Speech-to-Text) đồng âm/gần âm bị sai trong tiếng Trung/ngôn ngữ gốc (ví dụ: nhận nhầm tên người, tên địa danh, thuật ngữ) dựa trên sự bất nhất của dòng thời gian và bối cảnh để đính chính chính xác.

HÃY ĐẢM BẢO KẾT QUẢ ĐẦU RA TUÂN THỦ CHÍNH XÁC CẤU TRÚC VÀ PHONG CÁCH BẮT BUỘC SAU ĐÂY:

## Tóm tắt nội dung trong file srt. Ví dụ: Câu chuyện kể về Trần Trác, một người có bệnh tiền sử bệnh tâm thần được chữa trị tại bệnh viện Hàn Châu. Một ngày đẹp trời, Trần Trác được 1 vị bác sĩ trao cho năng lực thông thiên để cứu lấy thế giới.......vv

★ I. Style Gen: Style của phụ đề. Ví dụ: 
Style Gen: Kiếm hiệp - Tiên Hiệp

TONE & REGISTER:
- Bold, decisive, chivalrous — fitting for a jianghu setting.
- Combat scenes: extremely short, sharp sentences.
- Dialogue scenes: formal, dignified, jianghu style.

ADDRESS TERMS:
- Classical/archaic pronouns and jianghu-style address terms throughout.
- Classical forms for martial seniority: master, senior disciple, junior disciple, sect elder, grandmaster.
- Modern pronouns only for civilian characters.

VOCABULARY:
- Translate all martial arts, cultivation, and internal energy concepts into their classical equivalents.
- Includes: combat techniques, energy types, meridians, cultivation stages, spiritual artifacts, sects, battle formations.
- Do not use modern technology, corporate terms, or contemporary slang.

PROPER NAMES:
- Handle all proper names according to target language conventions.

★ II. Nhân vật - Mô tả vai trò . Nếu nhiều nhân vật trong 1 đoạn dịch thô thì mỗi nhân vật là 1 dòng, cạnh dòng kèm thêm ngôn ngữ gốc trong dấu ngoặc. Ví dụ:
- Nhân vật chính:
      + Trần Trác (ngôn ngữ gốc) - 1 bệnh nhân tâm thần
      + .......vvv
- Nhân vật phụ:
      + Quách Ngữ Thi (ngôn ngữ gốc) - Mẹ Trần Trác
      + Bác sĩ Trần (ngôn ngữ gốc) - Trưởng viện tâm thần
      + .....vv
Lưu ý 1: Trong đoạn thô tại Quy tắc 1 có các từ ngữ gốc có thể sai sót gây hiểu nhầm trong việc dịch tên nhân vật. Dựa vào việc phân tích và đối chiếu sự bất nhất trong dòng thời gian của đoạn phụ đề gốc để phát hiện ra chi tiết lỗi. 
Lưu ý 2: Sử dụng bộ dictionary tại tab dictionary để cập nhật chính xác nhất về thuật ngữ

★ III. Bối cảnh. Nếu nhiều bối cảnh trong 1 câu chuyện thì mỗi bối cảnh là 1 dòng, cạnh dòng kèm thêm ngôn ngữ gốc trong dấu ngoặc. Ví dụ:
- Bệnh viện Hàn Châu (ngôn ngữ gốc)
- Nhà Trần Trác (ngôn ngữ gốc)
- .....vv
Lưu ý: Trong đoạn thô tại Quy tắc 1 có các từ ngữ gốc có thể sai sót gây hiểu nhầm trong việc dịch bối cảnh. Dựa vào việc phân tích và đối chiếu sự bất nhất trong dòng thời gian của đoạn phụ đề gốc để phát hiện ra chi tiết lỗi. 
Lưu ý 2: Sử dụng bộ dictionary tại tab dictionary để cập nhật chính xác nhất về thuật ngữ`;

      const fullPrompt = `HỆ THỐNG CHỈ DẪN VAI TRÒ:\n${rule3SystemPrompt}\n\n===\n\nVĂN BẢN THÔ GỐC:\n${rawOriginalText.substring(0, 25000)}\n\n===\n\nBẢN DỊCH THÔ:\n${draftTranslation.substring(0, 25000)}\n\n===\n\nHãy tạo ra Bối cảnh & Từ điển Tham chiếu Quy tắc 3 chính xác nhất theo cấu trúc bắt buộc trên. Trả về đúng nội dung phân tích, không thêm bất cứ đoạn bọc code hay ký tự không cần thiết.`;

      while (!rule3Success) {
        try {
          if (await checkControlState()) {
            addLog('warning', `Dừng tiến trình dịch file "${fileData.name}" theo yêu cầu người dùng.`);
            return;
          }

          rule3Context = await runGeminiCookiesRule3(
            fullPrompt,
            {
              cookies: settings.cookiesGemini,
              proxy: settings.proxy,
              enableDeepThink: settings.enableDeepThink !== false,
              timeoutMs: 300000
            },
            (msg) => {
              addLog('info', `[Cookies Gemini] ${msg}`);
              updatePipelineThread(1, 'processing', -1, "Playwright Browser", `[Rule 3] ${msg}`);
            }
          );

          rule3Success = true;
          updatePipelineThread(1, 'success', -1, "Cookies Gemini", '[Rule 3] Xong phân tích ngữ cảnh qua Cookies');
        } catch (err: any) {
          addLog('error', `[Rule 3 Cookies Gemini] Lỗi tự động hóa: ${err.message || err}. Đang chuẩn bị thử lại...`);
          updatePipelineThread(1, 'error', -1, "Cookies Gemini Error", `Lỗi: ${err.message || err}`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    } else {
      // API mode
      let rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
      updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');

      while (!rule3Success) {
        try {
          if (await checkControlState()) {
            addLog('warning', `Dừng tiến trình dịch file "${fileData.name}" theo yêu cầu người dùng.`);
            CookiePool.releaseKey(rule3KeyItem.id);
            return;
          }

          const intervalMs = (settings.requestInterval !== undefined ? settings.requestInterval : 1) * 1000;
          const now = Date.now();
          const elapsed = now - rule3KeyItem.last_used_timestamp;
          const waitTime = intervalMs - elapsed;
          if (waitTime > 0) {
            await new Promise(r => setTimeout(r, waitTime));
          }

          const aiInstance = new GoogleGenAI({
            apiKey: rule3KeyItem.api_key,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });

          const dictPrompt = settings.dictionary && settings.dictionary.trim()
            ? `\n\nSử dụng bộ dictionary dưới đây làm dữ liệu tham chiếu CHÍNH XÁC NHẤT để dịch đúng các thuật ngữ, bối cảnh, tên nhân vật, danh xưng xưng hô và phong cách dịch:\n[BỘ DICTIONARY THAM KHẢO]\n${settings.dictionary.trim()}\n[HẾT BỘ DICTIONARY THAM KHẢO]\n`
            : "";

          const rule3SystemPrompt = `Bạn là một Đạo diễn kịch bản, Biên kịch xuất sắc và chuyên gia bản địa hóa phim chuyên nghiệp. 
Nhiệm vụ của bạn là đọc toàn bộ văn bản phụ đề gốc (Quy tắc 1) và bản dịch thô (Quy tắc 2), phân tích sâu sắc cốt truyện để đồng nhất bối cảnh, nhân vật, thuật ngữ, phong cách và nội dung câu chuyện.${dictPrompt}

Dựa vào sườn mẫu cực kỳ chi tiết dưới đây, hãy tự động phân tích và tạo ra Quy tắc 3 tương ứng cho THỂ LOẠI / STYLE của bộ phim hiện tại. Bạn phải phân tích cực kỳ kỹ lưỡng để phát hiện ra các lỗi nhận diện giọng nói (STT - Speech-to-Text) đồng âm/gần âm bị sai trong tiếng Trung/ngôn ngữ gốc (ví dụ: nhận nhầm tên người, tên địa danh, thuật ngữ) dựa trên sự bất nhất của dòng thời gian và bối cảnh để đính chính chính xác.

HÃY ĐẢM BẢO KẾT QUẢ ĐẦU RA TUÂN THỦ CHÍNH XÁC CẤU TRÚC VÀ PHONG CÁCH BẮT BUỘC SAU ĐÂY:

## Tóm tắt nội dung trong file srt. Ví dụ: Câu chuyện kể về Trần Trác, một người có bệnh tiền sử bệnh tâm thần được chữa trị tại bệnh viện Hàn Châu. Một ngày đẹp trời, Trần Trác được 1 vị bác sĩ trao cho năng lực thông thiên để cứu lấy thế giới.......vv

★ I. Style Gen: Style của phụ đề. Ví dụ: 
Style Gen: Kiếm hiệp - Tiên Hiệp

TONE & REGISTER:
- Bold, decisive, chivalrous — fitting for a jianghu setting.
- Combat scenes: extremely short, sharp sentences.
- Dialogue scenes: formal, dignified, jianghu style.

ADDRESS TERMS:
- Classical/archaic pronouns and jianghu-style address terms throughout.
- Classical forms for martial seniority: master, senior disciple, junior disciple, sect elder, grandmaster.
- Modern pronouns only for civilian characters.

VOCABULARY:
- Translate all martial arts, cultivation, and internal energy concepts into their classical equivalents.
- Includes: combat techniques, energy types, meridians, cultivation stages, spiritual artifacts, sects, battle formations.
- Do not use modern technology, corporate terms, or contemporary slang.

PROPER NAMES:
- Handle all proper names according to target language conventions.

★ II. Nhân vật - Mô tả vai trò . Nếu nhiều nhân vật trong 1 đoạn dịch thô thì mỗi nhân vật là 1 dòng, cạnh dòng kèm thêm ngôn ngữ gốc trong dấu ngoặc. Ví dụ:
- Nhân vật chính:
      + Trần Trác (ngôn ngữ gốc) - 1 bệnh nhân tâm thần
      + .......vvv
- Nhân vật phụ:
      + Quách Ngữ Thi (ngôn ngữ gốc) - Mẹ Trần Trác
      + Bác sĩ Trần (ngôn ngữ gốc) - Trưởng viện tâm thần
      + .....vv
Lưu ý 1: Trong đoạn thô tại Quy tắc 1 có các từ ngữ gốc có thể sai sót gây hiểu nhầm trong việc dịch tên nhân vật. Dựa vào việc phân tích và đối chiếu sự bất nhất trong dòng thời gian của đoạn phụ đề gốc để phát hiện ra chi tiết lỗi. 
Lưu ý 2: Sử dụng bộ dictionary tại tab dictionary để cập nhật chính xác nhất về thuật ngữ

★ III. Bối cảnh. Nếu nhiều bối cảnh trong 1 câu chuyện thì mỗi bối cảnh là 1 dòng, cạnh dòng kèm thêm ngôn ngữ gốc trong dấu ngoặc. Ví dụ:
- Bệnh viện Hàn Châu (ngôn ngữ gốc)
- Nhà Trần Trác (ngôn ngữ gốc)
- .....vv
Lưu ý: Trong đoạn thô tại Quy tắc 1 có các từ ngữ gốc có thể sai sót gây hiểu nhầm trong việc dịch bối cảnh. Dựa vào việc phân tích và đối chiếu sự bất nhất trong dòng thời gian của đoạn phụ đề gốc để phát hiện ra chi tiết lỗi. 
Lưu ý 2: Sử dụng bộ dictionary tại tab dictionary để cập nhật chính xác nhất về thuật ngữ`;

          const response = await aiInstance.models.generateContent({
            model: "gemini-3.5-flash",
            contents: `Văn bản thô gốc:\n${rawOriginalText.substring(0, 25000)}\n\nBản dịch thô:\n${draftTranslation.substring(0, 25000)}`,
            config: {
              systemInstruction: rule3SystemPrompt,
              temperature: 0.2,
            }
          });

          rule3Context = (response.text || "").trim();
          rule3KeyItem.last_used_timestamp = Date.now();
          rule3KeyItem.retry_lethal_count = 0;
          rule3KeyItem.requests_3_5_flash_count = (rule3KeyItem.requests_3_5_flash_count || 0) + 1;
          rule3KeyItem.total_requests_count = (rule3KeyItem.total_requests_count || 0) + 1;
          
          if (rule3KeyItem.requests_3_5_flash_count >= 20) {
            addLog('error', `[Đóng băng an toàn] API Key ${rule3KeyItem.email} đã đạt hạn mức an toàn 20 yêu cầu/ngày cho Gemini 3.5 Flash. Tiến hành đóng băng (EXHAUSTED).`);
            CookiePool.markAsExhausted(rule3KeyItem.id);
          }

          rule3Success = true;
          updatePipelineThread(1, 'success', -1, rule3KeyItem.email, '[Rule 3] Xong phân tích ngữ cảnh');

          // Track and cooling if hits 5 reqs/min
          if (!rule3KeyItem.request_timestamps) {
            rule3KeyItem.request_timestamps = [];
          }
          rule3KeyItem.request_timestamps.push(Date.now());
          const oneMinuteAgo = Date.now() - 60000;
          rule3KeyItem.request_timestamps = rule3KeyItem.request_timestamps.filter(t => t > oneMinuteAgo);

          if (rule3KeyItem.request_timestamps.length >= 5) {
            addLog('warning', `[Rule 3] API Key ${rule3KeyItem.email} đã đạt 5 yêu cầu/phút. Tiến hành đưa vào COOLING tạm nghỉ...`);
            CookiePool.markAsCooling(rule3KeyItem.id);
          } else {
            CookiePool.releaseKey(rule3KeyItem.id);
          }
        } catch (err: any) {
          const is401 = err.status === 401 ||
                        (err.message && (
                          err.message.includes("401") ||
                          err.message.toLowerCase().includes("unauthorized") ||
                          err.message.toLowerCase().includes("invalid_api_key") ||
                          err.message.toLowerCase().includes("api key not valid") ||
                          err.message.toLowerCase().includes("expired")
                        ));

          const is429 = err.status === 429 ||
                        (err.message && (
                          err.message.includes("429") ||
                          err.message.toLowerCase().includes("quota") ||
                          err.message.toLowerCase().includes("too many requests") ||
                          err.message.toLowerCase().includes("resource_exhausted") ||
                          err.message.toLowerCase().includes("rate limit")
                        ));

          const is503 = err.status === 503 ||
                        (err.message && (
                          err.message.includes("503") ||
                          err.message.toLowerCase().includes("unavailable") ||
                          err.message.toLowerCase().includes("high demand") ||
                          err.message.toLowerCase().includes("temporary") ||
                          err.message.toLowerCase().includes("overloaded")
                        ));

          if (is401 || err.status === 403) {
            addLog('error', `[Rule 3] Key ${rule3KeyItem.email} dính lỗi xác thực/vô hiệu hóa. Chuyển thành DEAD.`);
            updatePipelineThread(1, 'error', -1, `Lỗi Auth (DEAD): ${rule3KeyItem.email}`, '[Rule 3] Phân tích nhân vật & bối cảnh');
            CookiePool.markAsDead(rule3KeyItem.id);
            updatePipelineThread(1, 'idle', -1, "Đang đổi Key mới...", '[Rule 3] Phân tích nhân vật & bối cảnh');
            rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
            updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');
          } else if (is429) {
            addLog('warning', `[Rule 3] Key ${rule3KeyItem.email} dính lỗi 429 (Too Many Requests). Chuyển thành COOLING.`);
            updatePipelineThread(1, 'paused', -1, `Cooling (429): ${rule3KeyItem.email}`, '[Rule 3] Phân tích nhân vật & bối cảnh');
            CookiePool.markAsCooling(rule3KeyItem.id);
            updatePipelineThread(1, 'idle', -1, "Đang đổi Key mới...", '[Rule 3] Phân tích nhân vật & bối cảnh');
            rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
            updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');
          } else if (is503) {
            addLog('warning', `[Rule 3] Key ${rule3KeyItem.email} dính lỗi 503 (Model High Demand/Unavailable). Đang đưa vào COOLING và thử lại bằng khoá khác sau 5s...`);
            updatePipelineThread(1, 'paused', -1, `Cooling (503): ${rule3KeyItem.email}`, '[Rule 3] Phân tích nhân vật & bối cảnh');
            CookiePool.markAsCooling(rule3KeyItem.id);
            await new Promise(r => setTimeout(r, 5000));
            updatePipelineThread(1, 'idle', -1, "Đang đổi Key mới...", '[Rule 3] Phân tích nhân vật & bối cảnh');
            rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
            updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');
          } else {
            rule3KeyItem.retry_lethal_count += 1;
            addLog('error', `[Rule 3] Key ${rule3KeyItem.email} lỗi hệ thống/mạng (${rule3KeyItem.retry_lethal_count}/3): ${err.message || err}`);
            updatePipelineThread(1, 'error', -1, `Lỗi (${rule3KeyItem.retry_lethal_count}/3): ${rule3KeyItem.email}`, '[Rule 3] Phân tích nhân vật & bối cảnh');
            if (rule3KeyItem.retry_lethal_count >= 3) {
              addLog('error', `[Rule 3] Key ${rule3KeyItem.email} lỗi liên tiếp 3 lần. Chuyển thành DEAD.`);
              CookiePool.markAsDead(rule3KeyItem.id);
              updatePipelineThread(1, 'idle', -1, "Đang đổi Key mới...", '[Rule 3] Phân tích nhân vật & bối cảnh');
              rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
              updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');
            } else {
              CookiePool.releaseKey(rule3KeyItem.id);
              await new Promise(r => setTimeout(r, 2000));
              updatePipelineThread(1, 'idle', -1, "Thử lại cùng Key...", '[Rule 3] Phân tích nhân vật & bối cảnh');
              rule3KeyItem = await acquireCookieWithWait("Rule-3-Context");
              updatePipelineThread(1, 'processing', -1, rule3KeyItem.email, '[Rule 3] Phân tích nhân vật & bối cảnh');
            }
          }
        }
      }
    }

    fileData.rule3Context = rule3Context;
    fileData.progress = 50;
    
    // Auto-Pause here to let the user review and edit the Rule 3 Context before proceeding to Rule 4/5!
    fileData.status = 'paused';
    fileData.pauseStartTime = Date.now();
    activeFiles.set(fileId, fileData);
    addLog('warning', `[Tạm dừng tự động] Đã phân tích xong Rule 3 cho "${fileData.name}". Hệ thống tạm dừng để bạn kiểm duyệt và chỉnh sửa Bối cảnh & Từ điển Tham chiếu bên tab Dictionary. Hãy ấn "Run Tiếp Theo" để bắt đầu dịch thô/hiệu đính (Rule 4 & 5).`);

    const isAborted = await checkControlState();
    if (isAborted) {
      addLog('warning', `Tiến trình dịch file "${fileData.name}" bị dừng lại sau Bước 3.`);
      return;
    }

    // Re-load the updated file data in case the user edited the rule3Context on screen
    const updatedData = activeFiles.get(fileId);
    if (updatedData) {
      rule3Context = updatedData.rule3Context || rule3Context;
    }

    addLog('success', `[Rule 3] Đã kiểm duyệt và tiếp tục dịch file.`);

    // --- STEP 4 & 5: CONCURRENT SUBTITLE REFINEMENT & TRANSLATION ---
    const chunkSize = settings.chunkLine;
    const chunkBlocks: SRTBlock[][] = [];
    for (let i = 0; i < srtBlocks.length; i += chunkSize) {
      chunkBlocks.push(srtBlocks.slice(i, i + chunkSize));
    }

    const totalChunks = chunkBlocks.length;
    const rule45Model = settings.rule45Model || "gemini-3.5-flash";
    addLog('info', `[Rule 4 & 5] Dividing file into ${totalChunks} chunks of size ${chunkSize} (Model: ${rule45Model}).`);

    const rule4Results: string[] = new Array(totalChunks).fill("");
    const rule5Part1Results: string[] = new Array(totalChunks).fill("");
    const rule5Part2Results: string[] = new Array(totalChunks).fill("");
    const chunkStatuses: string[] = new Array(totalChunks).fill("pending");

    let currentChunkIdx = 0;

    function getNextChunkIdx() {
      if (currentChunkIdx >= totalChunks) return -1;
      return currentChunkIdx++;
    }

    let activeWorkers = threadLimit;

    // Output buffering tracking to preserve original timeline
    let nextSequentialChunk = 0;
    fileData.rule4Output = "";
    fileData.rule5Part1Output = "";
    fileData.rule5Part2Output = "";
    fileData.rule5Output = "";

    // Live threads tracking
    fileData.threads = [];
    for (let t = 1; t <= threadLimit; t++) {
      fileData.threads.push({
        id: t,
        chunkIndex: -1,
        totalChunks: totalChunks,
        apiKey: "Đang chờ...",
        status: "idle",
        lastUpdated: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
      });
    }
    activeFiles.set(fileId, fileData);

    return new Promise<void>((resolve, reject) => {
      async function startThread(threadId: number) {
        const updateThreadState = (status: 'idle' | 'processing' | 'paused' | 'stopped' | 'success' | 'error', chunkIdx: number, apiKeyEmail?: string) => {
          const freshData = activeFiles.get(fileId);
          if (freshData && freshData.threads) {
            const th = freshData.threads.find((x: any) => x.id === threadId);
            if (th) {
              th.status = status;
              th.chunkIndex = chunkIdx;
              if (chunkIdx === -1) {
                th.label = th.label || "Sẵn sàng";
              } else {
                th.label = `[Rule 4&5] Dịch chính thức ${chunkIdx + 1}/${totalChunks}`;
              }
              if (apiKeyEmail !== undefined) th.apiKey = apiKeyEmail;
              th.lastUpdated = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
              activeFiles.set(fileId, freshData);
            }
          }
        };

        addLog('info', `[Thread #${threadId}] Khởi động luồng dịch phụ đề.`);
        updateThreadState("idle", -1, "Sẵn sàng");

        let keyItem: any = null;

        try {
          while (true) {
            if (await checkControlState()) {
              addLog('info', `[Thread #${threadId}] Luồng dừng do lệnh dừng từ người dùng.`);
              updateThreadState("stopped", -1);
              break;
            }

            const myIdx = getNextChunkIdx();
            if (myIdx === -1) {
              break;
            }

            chunkStatuses[myIdx] = "running";
            addLog('info', `[Thread #${threadId}] Đang xử lý chunk ${myIdx + 1}/${totalChunks}...`);

            let success = false;
            let attempts = 0;

            while (!success) {
              try {
                if (await checkControlState()) {
                  addLog('info', `[Thread #${threadId}] Luồng dừng do lệnh dừng từ người dùng.`);
                  updateThreadState("stopped", -1);
                  break;
                }

                // Acquire API Key right before making the request (Fair Round-Robin)
                keyItem = await acquireCookieWithWait(`Thread-${threadId}`);
                updateThreadState("processing", myIdx, keyItem.email);

                const currentChunkData = chunkBlocks[myIdx];
                const chunkText = currentChunkData.map(b => `${b.index}\n${b.timeline}\n${b.text}`).join('\n\n');

                const chunkSystemPrompt = `Bạn là một chuyên gia hiệu đính và dịch thuật phụ đề phim chuyên nghiệp kiêm Chuyên gia Biên tập Timeline Phụ đề (SRT) xuất sắc cho lồng tiếng AI (Text-to-Speech).

BỘ LUẬT NGỮ CẢNH (ĐƯỢC THIẾT LẬP TỪ QUY TẮC 3):
${rule3Context}

Nhiệm vụ của bạn là thực hiện ba Quy trình (Quy tắc) sau dựa trên Bối cảnh, Nhân vật và Style Gen đồng nhất đã được đúc kết từ Quy tắc 3:

**Quy tắc 4 (HIỆU ĐÍNH PHỤ ĐỀ GỐC - ORIGINAL LANGUAGE REFINEMENT)**:
- Từ Quy tắc 1, 2, 3: Bạn hãy điều chỉnh nội dung phụ đề gốc đã gửi (bao gồm số thứ tự/timeline/nội dung phụ đề) theo nội dung đã chỉnh sửa đồng nhất câu từ/nội dung/nhân vật/bối cảnh tại Quy tắc 3.
- LƯU Ý: Điều chỉnh nội dung phụ đề gốc bằng NGÔN NGỮ GỐC (Ví dụ: giữ nguyên tiếng Trung, tiếng Anh... tùy thuộc vào ngôn ngữ gốc của file). Tuyệt đối không dịch sang tiếng Việt ở Quy tắc này.
- Số lượng block phụ đề và mốc thời gian phải khớp chính xác 100% với file gốc của chunk này gửi lên.
- Định dạng trả về phải là một file SRT chuẩn.

**Quy tắc 5 Phần 1 (DỊCH GỐC - BẢN DỊCH TIẾNG VIỆT CHƯA CHIA TÁCH LINE)**:
- Bạn hãy dịch đầy đủ toàn bộ nội dung phụ đề đã hiệu đính ở Quy tắc 4 sang Tiếng Việt.
- Hãy bám sát bối cảnh, nhân vật, đại từ xưng hô và style đã định nghĩa ở Quy tắc 3.
- Bản dịch phải tự nhiên, mượt mà nhưng KHÔNG được chia tách dòng, không thay đổi thời gian (timeline), không giới hạn ký tự ở quy trình này.
- Số lượng block phụ đề và mốc thời gian của Quy tắc 5 Phần 1 phải khớp chính xác 100% với file gốc của chunk này gửi lên.
- Định dạng trả về phải là một file SRT chuẩn.

**Quy tắc 5 Phần 2 (BIÊN TẬP TIMELINE SRT CHUYÊN BIỆT CHO LỒNG TIẾNG AI - TTS)**:
- Bạn hãy dựa trên bản dịch tiếng Việt hoàn chỉnh của Quy tắc 5 Phần 1 ở trên để tiến hành phân chia, tách dòng, phân bổ lại mốc thời gian và đánh số thứ tự theo các quy trình khắt khe sau để tối ưu hóa cho lồng tiếng AI (TTS):
  + QUY TẮC 1 - Giới hạn ký tự khắt khe: Quy định giới hạn tối đa 45 ký tự cho mỗi timeline block tiếng Việt (tính cả khoảng trắng và các dấu câu).
  + QUY TẮC 2 - Logic tách dòng thông minh:
    * Bắt buộc phải chia nhỏ câu khi vượt quá 45 ký tự.
    * Ưu tiên ngắt tự nhiên tại các dấu câu (,, ., ?, !) hoặc trước các từ liên kết nghĩa (mà, thì, là, và...) để câu văn mạch lạc, không bị rời rạc cụm từ liền nghĩa.
    * Nếu không có các dấu câu, nhưng timeline đã quá 45 ký tự: Vẫn phải tách timeline một cách hợp lý và giữ đúng nghĩa gốc.
  + QUY TẮC 3 - Logic chia thời gian (Timeline nối tiếp):
    * Phân bổ và cắt chia tổng thời gian của block gốc dựa trên tỷ lệ ký tự thực tế của từng phần sau khi tách.
    * Đảm bảo mốc thời gian của các phần sau khi tách là nối tiếp liên tục và không bị chồng lấn (Thời gian kết thúc của Phần 1 CHÍNH LÀ thời gian bắt đầu của Phần 2).
    * Cấu trúc mốc thời gian bắt buộc đúng chuẩn SRT: hh:mm:ss,ms --> hh:mm:ss,ms (Ví dụ: 00:02:42,330 --> 00:02:43,530).
  + QUY TẮC 4 - Chuẩn hóa chỉ số (Indexing):
    * Tự động dọn dẹp các chỉ số bị trùng lặp, lỗi chữ cái, hoặc nhảy số. Đánh lại toàn bộ số thứ tự timeline một cách liên tục từ 1 trở đi trong phạm vi cụm kết quả này.

BẢO TOÀN DẤU CÂU & KÝ TỰ ĐẶC BIỆT TRONG PHỤ ĐỀ TIẾNG VIỆT:
- Bạn phải giữ lại nguyên vẹn các dấu câu quan trọng phục vụ phân tách câu ngữ nghĩa và tạo ngữ điệu tự nhiên cho TTS (bao gồm các dấu câu: , . ? ! : ; ' " “ ” ‘ ’ ( ) -). Không được tự ý loại bỏ chúng.

CẢNH BÁO QUAN TRỌNG: 
1. BẠN BẮT BUỘC PHẢI TRẢ VỀ ĐẦY ĐỦ 100% CÁC DÒNG PHỤ ĐỀ TRONG CHUNK NÀY. TUYỆT ĐỐI KHÔNG ĐƯỢC TÓM TẮT, KHÔNG ĐƯỢC BỎ SÓT DÒNG. Với Quy tắc 4 và Quy tắc 5 Phần 1, số lượng block phải giữ nguyên đúng số dòng ban đầu. Với Quy tắc 5 Phần 2, số lượng block có thể nhiều hơn do việc tách các dòng > 45 ký tự, nhưng tuyệt đối không được bỏ sót bất kỳ dòng nội dung nào.
2. Tuân thủ tuyệt đối Style Gen và đại từ xưng hô đã được định nghĩa ở trên.

BẠN BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG SAU (Tuyệt đối không dùng markdown block code bọc lại, không thêm bất kỳ văn bản giải thích nào khác):
[QUY TẮC 4]
(Phụ đề ngôn ngữ gốc đã điều chỉnh tinh tế theo Quy tắc 3, định dạng SRT chuẩn)

[QUY TẮC 5 PHẦN 1]
(Phụ đề tiếng Việt dịch gốc chưa chia dòng, định dạng SRT chuẩn)

[QUY TẮC 5 PHẦN 2]
(Phụ đề tiếng Việt đã được xử lý và phân tách timeline hoàn chỉnh theo các quy tắc khắt khe trên, định dạng SRT chuẩn)`;

                // Smart Pacing Check with Random Delay 5-10 seconds to protect IP and key
                const randomDelayMs = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
                const intervalMs = (settings.requestInterval !== undefined ? settings.requestInterval : 1) * 1000;
                const now = Date.now();
                const elapsed = now - keyItem.last_used_timestamp;
                const finalDelayMs = Math.max(randomDelayMs, intervalMs - elapsed);

                addLog('info', `[Thread #${threadId}] Trì hoãn ngẫu nhiên ${(finalDelayMs / 1000).toFixed(1)} giây trước khi gọi API...`);
                await new Promise(r => setTimeout(r, finalDelayMs));

                const aiInstance = new GoogleGenAI({
                  apiKey: keyItem.api_key,
                  httpOptions: {
                    headers: {
                      'User-Agent': 'aistudio-build',
                    }
                  }
                });

                const response = await aiInstance.models.generateContent({
                  model: rule45Model,
                  contents: `TOÀN BỘ BẢN DỊCH THÔ (QUY TẮC 2) ĐỂ THAM KHẢO TOÀN BỘ BỐI CẢNH/NỘI DUNG:
--- BẮT ĐẦU QUY TẮC 2 ---
${draftTranslation}
--- KẾT THÚC QUY TẮC 2 ---

ĐOẠN PHỤ ĐỀ CẦN XỬ LÝ CỦA CHUNK NÀY (HÃY ÁP DỤNG QUY TẮC 4, QUY TẮC 5 PHẦN 1 VÀ QUY TẮC 5 PHẦN 2 LÊN ĐOẠN NÀY):
${chunkText}`,
                  config: {
                    systemInstruction: chunkSystemPrompt,
                    temperature: 0.2,
                  }
                });

                const respText = response.text || "";

                // Parsing Rule 4, Rule 5 Part 1, and Rule 5 Part 2
                let r4 = "";
                let r5p1 = "";
                let r5p2 = "";

                const r4Match = respText.match(/\[QUY TẮC 4\]([\s\S]*?)(?=\[QUY TẮC 5 PHẦN 1\]|\[QUY TẮC 5 PHẦN 2\]|$)/i);
                const r5p1Match = respText.match(/\[QUY TẮC 5 PHẦN 1\]([\s\S]*?)(?=\[QUY TẮC 5 PHẦN 2\]|\[QUY TẮC 4\]|$)/i);
                const r5p2Match = respText.match(/\[QUY TẮC 5 PHẦN 2\]([\s\S]*?)(?=\[QUY TẮC 4\]|\[QUY TẮC 5 PHẦN 1\]|$)/i);

                if (r4Match) r4 = r4Match[1].trim();
                if (r5p1Match) r5p1 = r5p1Match[1].trim();
                if (r5p2Match) r5p2 = r5p2Match[1].trim();

                // Robust fallback
                if (!r4 && !r5p1 && !r5p2) {
                  const parts = respText.split(/\[QUY TẮC 5 PHẦN 2\]/i);
                  if (parts.length >= 2) {
                    r5p2 = parts[1].trim();
                    const subParts = parts[0].split(/\[QUY TẮC 5 PHẦN 1\]/i);
                    if (subParts.length >= 2) {
                      r5p1 = subParts[1].trim();
                      r4 = subParts[0].replace(/\[QUY TẮC 4\]/i, '').trim();
                    } else {
                      r4 = subParts[0].replace(/\[QUY TẮC 4\]/i, '').trim();
                    }
                  } else {
                    r4 = chunkText; // fallback to original input
                    r5p1 = "--- Dịch Lỗi ---\n" + respText;
                    r5p2 = respText;
                  }
                }

                // Standard cleanup helper
                const cleanBlockText = (text: string) => {
                  return text.split('\n').map(line => {
                    if (!line.trim()) return line;
                    if (/^\s*\d+\s*$/.test(line)) return line;
                    if (line.includes("-->")) return line;
                    let cleaned = line.replace(/[^\p{L}\p{N}\s,.\?!:;'"“”‘’()-]/gu, '');
                    return cleaned.replace(/\s+/g, ' ').trim();
                  }).join('\n');
                };

                const cleanedR4 = cleanBlockText(r4);
                const cleanedR5P1 = cleanBlockText(r5p1);
                const cleanedR5P2 = cleanBlockText(r5p2);

                rule4Results[myIdx] = cleanedR4;
                rule5Part1Results[myIdx] = cleanedR5P1;
                rule5Part2Results[myIdx] = cleanedR5P2;
                chunkStatuses[myIdx] = "completed";
                success = true;

                updateThreadState("success", myIdx, keyItem.email);
                addLog('success', `[Thread #${threadId}] Đã hoàn thành dịch chunk ${myIdx + 1}/${totalChunks} bằng API Key ${keyItem.email}`);

                keyItem.last_used_timestamp = Date.now();
                keyItem.retry_lethal_count = 0; // Reset consecutive failures on success

                // Increment total request counters for anti-spam cooling threshold
                if (rule45Model === 'gemini-2.5-flash') {
                  keyItem.requests_2_5_flash_count = (keyItem.requests_2_5_flash_count || 0) + 1;
                } else {
                  keyItem.requests_3_5_flash_count = (keyItem.requests_3_5_flash_count || 0) + 1;
                }
                keyItem.total_requests_count = (keyItem.total_requests_count || 0) + 1;
                keyItem.requests_since_cooling = (keyItem.requests_since_cooling || 0) + 1;
                
                addLog('info', `[Thread #${threadId}] API Key ${keyItem.email} (${rule45Model}) đã gọi thành công ${keyItem.requests_since_cooling}/${keyItem.cooling_threshold} yêu cầu. Yêu cầu trong ngày: Gemini 2.5: ${keyItem.requests_2_5_flash_count || 0}/20, Gemini 3.5/3.6: ${keyItem.requests_3_5_flash_count || 0}/20, Tổng: ${keyItem.total_requests_count}/40.`);

                // Check proactive daily safety limit of 20 requests/day first
                if (keyItem.requests_3_5_flash_count >= 20) {
                  addLog('error', `[Đóng băng an toàn] API Key ${keyItem.email} đã đạt hạn mức an toàn 20 yêu cầu/ngày cho Gemini 3.5 Flash. Tiến hành đóng băng (EXHAUSTED) cho đến 15:00 ngày hôm sau.`);
                  CookiePool.markAsExhausted(keyItem.id);
                } else if (keyItem.requests_since_cooling >= (keyItem.cooling_threshold || 50)) {
                  // Random cooldown of 1 to 2 minutes
                  const cooldownSecs = Math.floor(Math.random() * (120 - 60 + 1)) + 60;
                  addLog('warning', `[Thread #${threadId}] API Key ${keyItem.email} đạt ngưỡng ${keyItem.cooling_threshold} requests! Tạm đưa Key vào chế độ nghỉ mát (Cooling) trong ${cooldownSecs} giây để tránh spam.`);
                  
                  keyItem.status = 'COOLING';
                  keyItem.cooldown_until = Date.now() + (cooldownSecs * 1000);
                  CookiePool.syncGlobalCredentials();
                } else {
                  // Record request and check limit if it hits 5 reqs/min (fallback rate limit protection)
                  if (!keyItem.request_timestamps) {
                    keyItem.request_timestamps = [];
                  }
                  keyItem.request_timestamps.push(Date.now());
                  const oneMinuteAgo = Date.now() - 60000;
                  keyItem.request_timestamps = keyItem.request_timestamps.filter(t => t > oneMinuteAgo);

                  if (keyItem.request_timestamps.length >= 5) {
                    addLog('warning', `[Thread #${threadId}] API Key ${keyItem.email} đã đạt 5 yêu cầu/phút. Tiến hành đưa Key vào chế độ nghỉ mát...`);
                    CookiePool.markAsCooling(keyItem.id);
                  } else {
                    // Release key back to the pool as it is healthy and free
                    CookiePool.releaseCookie(keyItem.id);
                  }
                }

                // Reset thread-level reference to signal it's been handled
                keyItem = null;

                // Sequential Output Buffer: Output Chunk N only if all preceding chunks (0 to N-1) are completed
                while (nextSequentialChunk < totalChunks && chunkStatuses[nextSequentialChunk] === "completed") {
                  const seqR4 = rule4Results[nextSequentialChunk];
                  const seqR5P1 = rule5Part1Results[nextSequentialChunk];
                  const seqR5P2 = rule5Part2Results[nextSequentialChunk];
                  
                  fileData.rule4Output = (fileData.rule4Output || "") + (fileData.rule4Output ? "\n\n" : "") + `--- CỤM ${nextSequentialChunk + 1} ---\n` + seqR4;
                  fileData.rule5Part1Output = (fileData.rule5Part1Output || "") + (fileData.rule5Part1Output ? "\n\n" : "") + `--- CỤM ${nextSequentialChunk + 1} ---\n` + seqR5P1;
                  fileData.rule5Part2Output = (fileData.rule5Part2Output || "") + (fileData.rule5Part2Output ? "\n\n" : "") + `--- CỤM ${nextSequentialChunk + 1} ---\n` + seqR5P2;
                  fileData.rule5Output = fileData.rule5Part2Output;
                  
                  nextSequentialChunk++;
                }

                const completedCount = chunkStatuses.filter(s => s === "completed").length;
                fileData.progress = Math.floor(50 + (completedCount / totalChunks) * 45);
                activeFiles.set(fileId, fileData);

              } catch (err: any) {
                attempts++;
                
                const is401 = err.status === 401 ||
                              (err.message && (
                                err.message.includes("401") ||
                                err.message.toLowerCase().includes("unauthorized") ||
                                err.message.toLowerCase().includes("invalid_api_key") ||
                                err.message.toLowerCase().includes("api key not valid") ||
                                err.message.toLowerCase().includes("expired")
                              ));

                const is429 = err.status === 429 ||
                              (err.message && (
                                err.message.includes("429") ||
                                err.message.toLowerCase().includes("quota") ||
                                err.message.toLowerCase().includes("too many requests") ||
                                err.message.toLowerCase().includes("resource_exhausted") ||
                                err.message.toLowerCase().includes("rate limit")
                              ));

                const is503 = err.status === 503 ||
                              (err.message && (
                                err.message.includes("503") ||
                                err.message.toLowerCase().includes("unavailable") ||
                                err.message.toLowerCase().includes("high demand") ||
                                err.message.toLowerCase().includes("temporary") ||
                                err.message.toLowerCase().includes("overloaded")
                              ));

                if (is401 || err.status === 403) {
                  addLog('error', `[Thread #${threadId}] Lỗi xác thực/vô hiệu hóa. Key ${keyItem.email} -> DEAD.`);
                  updateThreadState("error", myIdx, `Lỗi Auth (DEAD): ${keyItem.email}`);
                  CookiePool.markAsDead(keyItem.id);
                } else if (is429) {
                  const errorStr = err.message || err.toString() || "";
                  const isRequestsPerDay = errorStr.toLowerCase().includes("requestsperday") || errorStr.toLowerCase().includes("requests per day");
                  if (isRequestsPerDay) {
                    addLog('error', `[Thread #${threadId}] Lỗi RequestsPerDay (Hết Quota ngày). Đưa Key ${keyItem.email} vào trạng thái FREEZING đến 15h chiều ngày hôm sau.`);
                    updateThreadState("paused", myIdx, `Freezing (RequestsPerDay): ${keyItem.email}`);
                    CookiePool.markAsExhausted(keyItem.id);
                  } else {
                    addLog('warning', `[Thread #${threadId}] Lỗi 429 (Too Many Requests). Đưa Key ${keyItem.email} vào trạng thái COOLING.`);
                    updateThreadState("paused", myIdx, `Cooling (429): ${keyItem.email}`);
                    CookiePool.markAsCooling(keyItem.id);
                  }
                } else if (is503) {
                  addLog('warning', `[Thread #${threadId}] Gặp lỗi 503 (Model High Demand/Unavailable) tại chunk ${myIdx + 1}. Đưa Key ${keyItem.email} vào trạng thái COOLING và thử lại...`);
                  updateThreadState("paused", myIdx, `Cooling (503): ${keyItem.email}`);
                  CookiePool.markAsCooling(keyItem.id);
                  await new Promise(r => setTimeout(r, 5000));
                } else {
                  // Other error (network, timeout, etc.)
                  keyItem.retry_lethal_count += 1;
                  addLog('error', `[Thread #${threadId}] Lỗi hệ thống/mạng tại chunk ${myIdx + 1} (Số lần lỗi của Key: ${keyItem.retry_lethal_count}/3): ${err.message || err}`);
                  updateThreadState("error", myIdx, `Lỗi (${keyItem.retry_lethal_count}/3): ${keyItem.email}`);
                  
                  if (keyItem.retry_lethal_count >= 3) {
                    addLog('error', `[Thread #${threadId}] Key ${keyItem.email} dính lỗi liên tiếp 3 lần. Chuyển thành DEAD.`);
                    CookiePool.markAsDead(keyItem.id);
                  } else {
                    addLog('info', `[Thread #${threadId}] Giải phóng và thử lại cùng Key ${keyItem.email} sau 2s...`);
                    CookiePool.releaseKey(keyItem.id);
                    await new Promise(r => setTimeout(r, 2000));
                  }
                }

                // Reset keyItem so it is not released again in finally
                keyItem = null;
              }
            }
          }
        } catch (threadErr: any) {
          addLog('error', `[Thread #${threadId}] Lỗi luồng nghiêm trọng: ${threadErr.message || threadErr}`);
        } finally {
          if (keyItem) {
            CookiePool.releaseKey(keyItem.id);
          }
          activeWorkers--;
          addLog('info', `[Thread #${threadId}] Hoàn thành công việc, tắt luồng.`);
          updateThreadState("stopped", -1, "Đã tắt");
          
          if (activeWorkers === 0) {
            finalizePipeline();
          }
        }
      }

      function finalizePipeline() {
        try {
          const freshData = activeFiles.get(fileId);
          if (freshData && freshData.status === 'stopped') {
            addLog('warning', `Dừng hoàn toàn tiến trình dịch cho file: ${fileData.name}`);
            resolve();
            return;
          }

          const fullRule4 = reindexAndCleanSRT(rule4Results.join('\n\n'));
          const fullRule5Part1 = reindexAndCleanSRT(rule5Part1Results.join('\n\n'));
          const fullRule5Part2 = reindexAndCleanSRT(rule5Part2Results.join('\n\n'));

          fileData.rule4Output = fullRule4;
          fileData.rule5Part1Output = fullRule5Part1;
          fileData.rule5Part2Output = fullRule5Part2;
          fileData.rule5Output = fullRule5Part2; // For backwards compatibility
          fileData.status = 'completed';
          fileData.progress = 100;
          activeFiles.set(fileId, fileData);

          // Export Rule 5 Part 2 output to [Tên file import]_vi.srt
          try {
            let baseName = fileData.name;
            if (baseName.toLowerCase().endsWith('.srt')) {
              baseName = baseName.substring(0, baseName.length - 4);
            }
            const outputFilename = `${baseName}_vi.srt`;
            fs.writeFileSync(path.join(process.cwd(), outputFilename), fullRule5Part2, 'utf8');
            addLog('success', `Xuất file Rule 5 thành công: ${outputFilename}`);
          } catch (fileWriteErr: any) {
            addLog('error', `Lỗi xuất file srt cho Rule 5: ${fileWriteErr.message || fileWriteErr}`);
          }

          fileData.endTime = Date.now();
          if (fileData.startTime) {
            fileData.elapsedTime = fileData.endTime - fileData.startTime - (fileData.totalPausedDuration || 0);
          }
          activeFiles.set(fileId, fileData);

          const hanoiTime = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
          const hanoiDate = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
          const historyEntry = {
            id: fileId,
            filename: fileData.name,
            timestamp: hanoiTime + " " + hanoiDate,
            status: 'completed',
            sourceLang: settings.sourceLang,
            targetLang: settings.targetLang,
            rule3Context: fileData.rule3Context,
            rule4Output: fullRule4,
            rule5Part1Output: fullRule5Part1,
            rule5Part2Output: fullRule5Part2,
            rule5Output: fullRule5Part2,
            elapsedTime: fileData.elapsedTime,
          };
          translationHistory.push(historyEntry);

          addLog('success', `Translation Pipeline COMPLETED for file: ${fileData.name}! 🎉`);
          resolve();
        } catch (err: any) {
          reject(err);
        }
      }

      for (let w = 1; w <= threadLimit; w++) {
        startThread(w);
      }
    });

  } catch (error: any) {
    addLog('error', `Pipeline failed: ${error.message || error}`);
    fileData.status = 'error';
    fileData.progress = 100;
    fileData.errorMsg = error.message || String(error);
    fileData.endTime = Date.now();
    if (fileData.startTime) {
      fileData.elapsedTime = fileData.endTime - fileData.startTime - (fileData.totalPausedDuration || 0);
    }
    activeFiles.set(fileId, fileData);

    const hanoiTime = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const hanoiDate = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const historyEntry = {
      id: fileId,
      filename: fileData.name,
      timestamp: hanoiTime + " " + hanoiDate,
      status: 'error',
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
      errorMsg: error.message || String(error),
      elapsedTime: fileData.elapsedTime,
    };
    translationHistory.push(historyEntry);
  }
}

// REST API Endpoints

// File upload endpoint (receives json)
app.post("/api/files/upload", (req, res) => {
  const { files } = req.body;
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: "No files provided or invalid format." });
  }

  const uploadedFiles = [];
  for (const f of files) {
    const fileId = Math.random().toString(36).substring(7);
    const item = {
      id: fileId,
      name: f.name,
      size: f.size || `${Math.ceil(f.content.length / 1024)} KB`,
      status: 'pending',
      progress: 0,
      originalContent: f.content,
      blocks: [],
      rawText: "",
      draftTranslation: "",
      rule3Context: "",
      rule4Output: "",
      rule5Part1Output: "",
      rule5Part2Output: "",
      rule5Output: "",
      startTime: undefined,
      endTime: undefined,
      elapsedTime: 0,
      pauseStartTime: undefined,
      totalPausedDuration: 0,
    };
    activeFiles.set(fileId, item);
    uploadedFiles.push({ id: fileId, name: f.name, size: item.size, status: 'pending' });
    addLog('info', `Imported subtitle file: ${f.name}`);
  }

  res.json({ files: uploadedFiles });
});

// Update Rule 3 Context for a specific file
app.post("/api/files/update-context", (req, res) => {
  const { fileId, rule3Context } = req.body;
  if (!fileId) {
    return res.status(400).json({ error: "Missing fileId" });
  }
  const fileData = activeFiles.get(fileId);
  if (fileData) {
    fileData.rule3Context = rule3Context || "";
    activeFiles.set(fileId, fileData);
    addLog('info', `Đã cập nhật Bối cảnh & Từ điển Tham chiếu thủ công cho file: ${fileData.name}`);
    res.json({ success: true, file: fileData });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Parse docx file to plain text for Dictionary Tab
app.post("/api/dictionary/parse-docx", async (req, res) => {
  try {
    const { base64Data } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: "No base64 data provided" });
    }
    const buffer = Buffer.from(base64Data, "base64");
    const result = await mammoth.extractRawText({ buffer });
    res.json({ text: result.value || "" });
  } catch (error: any) {
    console.error("Error parsing docx file:", error);
    res.status(500).json({ error: "Failed to parse docx document: " + error.message });
  }
});

// Helper to calculate elapsedTime dynamically for client responses
function getFilesWithElapsedTime() {
  return Array.from(activeFiles.values()).map(file => {
    let elapsedTime = file.elapsedTime || 0;
    if (file.startTime && !file.endTime) {
      if (file.status === 'paused' && file.pauseStartTime) {
        elapsedTime = file.pauseStartTime - file.startTime - (file.totalPausedDuration || 0);
      } else if (file.status === 'translating') {
        elapsedTime = Date.now() - file.startTime - (file.totalPausedDuration || 0);
      }
    }
    return { ...file, elapsedTime };
  });
}

// Clear files endpoint (handles index ranges e.g. #1-#10)
app.post("/api/files/clear", (req, res) => {
  const { ids, range } = req.body;
  
  if (range && typeof range === 'string') {
    addLog('info', `Clearing requested range: ${range}`);
    const filesArray = Array.from(activeFiles.values());
    
    // Parse ranges like "#1-#10", "#1, #10", "#5"
    const parsedIndices = new Set<number>();
    const tokens = range.replace(/#/g, '').split(/,|\s+/);
    
    for (const t of tokens) {
      if (t.includes('-')) {
        const parts = t.split('-');
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) {
            parsedIndices.add(i - 1);
          }
        }
      } else {
        const idx = parseInt(t, 10);
        if (!isNaN(idx)) {
          parsedIndices.add(idx - 1);
        }
      }
    }

    parsedIndices.forEach(idx => {
      if (idx >= 0 && idx < filesArray.length) {
        activeFiles.delete(filesArray[idx].id);
      }
    });

    return res.json({ success: true, files: getFilesWithElapsedTime() });
  }

  if (Array.isArray(ids)) {
    ids.forEach(id => activeFiles.delete(id));
  } else {
    activeFiles.clear();
  }
  
  res.json({ success: true, files: getFilesWithElapsedTime() });
});

// Fetch active files
app.get("/api/files", (req, res) => {
  res.json({ files: getFilesWithElapsedTime() });
});

// GET currently loaded credentials/cookies
app.get("/api/credentials", (req, res) => {
  CookiePool.checkCoolingAndDefrost();
  res.json({ credentials: globalCredentials });
});

// Sync credentials from client state
app.post("/api/credentials/sync", (req, res) => {
  const { credentials } = req.body;
  CookiePool.initialize(credentials || []);
  res.json({ success: true, credentials: globalCredentials });
});

// Trigger pipeline
app.post("/api/translate/run", (req, res) => {
  const { fileIds, settings, credentials } = req.body;
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "No files specified for translation." });
  }

  // Ensure CookiePool is synced and initialized with client credentials
  CookiePool.initialize(credentials || []);

  // Run pipeline as asynchronous tasks on the server
  for (const id of fileIds) {
    const data = activeFiles.get(id);
    if (data) {
      if (data.status === 'stopped' || data.status === 'error' || data.status === 'completed' || data.status === 'pending') {
        executeTranslationPipeline(id, settings);
      }
    }
  }

  res.json({ success: true });
});

// Pause translation
app.post("/api/translate/pause", (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "No files specified." });
  }
  for (const id of fileIds) {
    const data = activeFiles.get(id);
    if (data && data.status === 'translating') {
      data.status = 'paused';
      data.pauseStartTime = Date.now();
      activeFiles.set(id, data);
      addLog('warning', `Đã tạm dừng tiến trình dịch file: ${data.name}`);
    }
  }
  res.json({ success: true, files: getFilesWithElapsedTime() });
});

// Resume translation
app.post("/api/translate/resume", (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "No files specified." });
  }
  for (const id of fileIds) {
    const data = activeFiles.get(id);
    if (data && data.status === 'paused') {
      data.status = 'translating';
      if (data.pauseStartTime) {
        data.totalPausedDuration = (data.totalPausedDuration || 0) + (Date.now() - data.pauseStartTime);
        data.pauseStartTime = undefined;
      }
      activeFiles.set(id, data);
      addLog('success', `Đã tiếp tục tiến trình dịch file: ${data.name}`);
    }
  }
  res.json({ success: true, files: getFilesWithElapsedTime() });
});

// Stop translation
app.post("/api/translate/stop", (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "No files specified." });
  }
  for (const id of fileIds) {
    const data = activeFiles.get(id);
    if (data && (data.status === 'translating' || data.status === 'paused')) {
      if (data.status === 'paused' && data.pauseStartTime) {
        data.totalPausedDuration = (data.totalPausedDuration || 0) + (Date.now() - data.pauseStartTime);
        data.pauseStartTime = undefined;
      }
      data.status = 'stopped';
      data.endTime = Date.now();
      if (data.startTime) {
        data.elapsedTime = data.endTime - data.startTime - (data.totalPausedDuration || 0);
      }
      activeFiles.set(id, data);
      addLog('error', `Đã dừng hoàn toàn tiến trình dịch file: ${data.name}`);
    }
  }
  res.json({ success: true, files: getFilesWithElapsedTime() });
});

// Query live status of file translation
app.get("/api/translate/status/:fileId", (req, res) => {
  const { fileId } = req.params;
  const data = activeFiles.get(fileId);
  if (!data) {
    return res.status(404).json({ error: "File not found." });
  }
  let elapsedTime = data.elapsedTime || 0;
  if (data.startTime && !data.endTime) {
    if (data.status === 'paused' && data.pauseStartTime) {
      elapsedTime = data.pauseStartTime - data.startTime - (data.totalPausedDuration || 0);
    } else if (data.status === 'translating') {
      elapsedTime = Date.now() - data.startTime - (data.totalPausedDuration || 0);
    }
  }
  res.json({ file: { ...data, elapsedTime } });
});

// Check credentials live status
app.post("/api/credentials/check", async (req, res) => {
  const { credentials } = req.body;
  if (!credentials || !Array.isArray(credentials)) {
    return res.status(400).json({ error: "Invalid credentials array." });
  }

  addLog('info', `Checking live status for ${credentials.length} credentials.`);

  const results = [];
  for (let i = 0; i < credentials.length; i++) {
    const cred = credentials[i];
    
    // Thêm khoảng nghỉ giữa các lần kiểm tra key để bảo vệ IP và tránh làm chết key
    if (i > 0) {
      addLog('info', `Đang tạm nghỉ 1.5 giây trước khi kiểm tra khoá tiếp theo để bảo vệ IP...`);
      await new Promise(r => setTimeout(r, 1500));
    }

    const keyStatus = await validateKeyStatus(cred.keyOrCookie);
    let cooldown_until = cred.cooldown_until;
    if (keyStatus === 'COOLING') {
      cooldown_until = Date.now() + 60000; // 60s cooldown
    } else if (keyStatus === 'EXHAUSTED') {
      cooldown_until = getNextDay3PMVietnam();
    } else if (keyStatus === 'LIVE') {
      cooldown_until = undefined;
    }

    results.push({
      ...cred,
      status: keyStatus,
      cooldown_until: cooldown_until
    });
    
    const logLevel = keyStatus === 'LIVE' ? 'success' : (keyStatus === 'COOLING' ? 'warning' : 'error');
    addLog(logLevel, `Kiểm tra khoá của ${cred.email || 'Unknown Email'}: ${keyStatus}`);
  }

  CookiePool.initialize(results);

  res.json({ credentials: results });
});

// Check Gemini Cookie __Secure-1PSID live status
app.post("/api/cookies/check", async (req, res) => {
  const { cookie, proxy } = req.body;
  if (!cookie || typeof cookie !== 'string') {
    return res.status(400).json({ error: "Yêu cầu cung cấp chuỗi cookie." });
  }

  try {
    const cleanCookie = cookie.trim();
    if (cleanCookie.length < 50) {
      return res.json({ status: 'dead', error: 'Độ dài cookie quá ngắn (phải trên 50 ký tự).' });
    }

    addLog('info', "Bắt đầu tiến trình kiểm tra Cookie qua trình duyệt ẩn danh Playwright...");
    const checkResult = await checkCookieLivePlaywright(
      cleanCookie, 
      proxy, 
      (msg) => addLog('info', `[Cookie Check] ${msg}`)
    );

    if (checkResult.status === 'live') {
      addLog('success', `Kiểm tra Cookie __Secure-1PSID hoàn tất: Hoạt động tốt (LIVE)!`);
      res.json({ status: 'live' });
    } else {
      addLog('error', `Kiểm tra Cookie __Secure-1PSID hoàn tất: Không hoạt động (DEAD) - ${checkResult.error}`);
      res.json({ status: 'dead', error: checkResult.error });
    }
  } catch (err: any) {
    console.error('Verify cookie error:', err);
    res.json({ status: 'dead', error: `Lỗi bất ngờ trong quá trình kiểm tra: ${err.message || err}` });
  }
});

// Retrieve system logs
app.get("/api/logs", (req, res) => {
  res.json({ logs: systemLogs });
});

// Clear system logs
app.post("/api/logs/clear", (req, res) => {
  systemLogs.length = 0;
  res.json({ success: true, logs: [] });
});

// Retrieve history
app.get("/api/history", (req, res) => {
  res.json({ history: translationHistory });
});

// Clear history
app.post("/api/history/clear", (req, res) => {
  translationHistory.length = 0;
  res.json({ success: true, history: [] });
});

// Download endpoints
app.get("/api/download/:fileId/:type", (req, res) => {
  const { fileId, type } = req.params;
  const data = activeFiles.get(fileId) || translationHistory.find(h => h.id === fileId);
  
  if (!data) {
    return res.status(404).send("File or history item not found.");
  }

  let content = "";
  let filename = "";
  let contentType = "text/plain";

  let baseName = data.name || data.filename || "subtitles";
  if (baseName.toLowerCase().endsWith('.srt')) {
    baseName = baseName.substring(0, baseName.length - 4);
  }

  if (type === "rule4_srt") {
    content = data.rule4Output || "No refined original output yet.";
    filename = `${baseName}_Original_Refined.srt`;
    contentType = "text/srt";
  } else if (type === "edited_srt" || type === "rule5_part1_srt") {
    content = data.rule5Part1Output || "No translated original output yet.";
    filename = `${baseName}_vi_Original.srt`;
    contentType = "text/srt";
  } else if (type === "translated_srt" || type === "rule5_part2_srt") {
    content = data.rule5Part2Output || data.rule5Output || "No translation timeline output yet.";
    filename = `${baseName}_vi_Timeline.srt`;
    contentType = "text/srt";
  } else if (type === "word_report") {
    // Generate an incredibly elegant HTML-based doc report that opens in MS Word with beautiful formatting!
    const title = data.name || data.filename || "Subtitle Translation Report";
    content = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333333; padding: 20px; }
          h1 { color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
          h2 { color: #2563eb; margin-top: 24px; }
          .section { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 15px; margin: 15px 0; border-radius: 4px; }
          .meta-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .meta-table th, .meta-table td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
          .meta-table th { background: #f1f5f9; color: #475569; }
          .pre-wrap { white-space: pre-wrap; font-family: Courier, monospace; font-size: 10pt; background: #fafafa; padding: 10px; border-radius: 4px; border: 1px solid #eaeaea; }
        </style>
      </head>
      <body>
        <h1>VIBETRANSLATOR - LOCALIZATION REPORT</h1>
        <p><strong>Source File:</strong> ${data.name || data.filename}</p>
        <p><strong>Processed Date:</strong> ${data.timestamp || new Date().toLocaleString()}</p>
        
        <h2>Rule 3: Localization Context & Rules</h2>
        <div class="section">
          <div class="pre-wrap">${data.rule3Context || "No context created."}</div>
        </div>

        <h2>Rule 4 & 5 Output Comparison</h2>
        <table class="meta-table">
          <thead>
            <tr>
              <th style="width: 33%;">Rule 4: Refined Subtitles (Original Language)</th>
              <th style="width: 33%;">Rule 5 Phần 1: Translated Subtitles (Undivided)</th>
              <th style="width: 34%;">Rule 5 Phần 2: Polished Subtitles (TTS Optimized)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="vertical-align: top; font-family: Courier, monospace; font-size: 9pt;"><div class="pre-wrap">${data.rule4Output || ""}</div></td>
              <td style="vertical-align: top; font-family: Courier, monospace; font-size: 9pt;"><div class="pre-wrap">${data.rule5Part1Output || ""}</div></td>
              <td style="vertical-align: top; font-family: Courier, monospace; font-size: 9pt;"><div class="pre-wrap">${data.rule5Part2Output || data.rule5Output || ""}</div></td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
    filename = `${data.name || data.filename}_VibeTranslated_Report.doc`;
    contentType = "application/msword";
  } else {
    return res.status(400).send("Invalid download type requested.");
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', contentType);
  res.send(content);
});

// Setup Vite Dev server or static asset delivery
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog('info', `VibeTranslator Server running on port ${PORT}`);
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
