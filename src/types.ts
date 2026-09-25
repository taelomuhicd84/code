export interface SRTBlock {
  index: string;
  timeline: string;
  text: string;
}

export interface FileItem {
  id: string;
  name: string;
  size: string;
  status: 'pending' | 'translating' | 'completed' | 'error' | 'paused' | 'stopped';
  progress: number;
  blocks?: SRTBlock[];
  rawText?: string;
  draftTranslation?: string;
  rule3Context?: string;
  rule4Output?: string;
  rule5Part1Output?: string;
  rule5Part2Output?: string;
  rule5Output?: string;
  errorMsg?: string;
  elapsedTime?: number;
  threads?: Array<{
    id: number;
    chunkIndex: number;
    totalChunks: number;
    apiKey: string;
    status: 'idle' | 'processing' | 'paused' | 'stopped' | 'success' | 'error';
    lastUpdated: string;
    label?: string;
  }>;
}

export interface CredentialItem {
  id: string;
  email: string;
  keyOrCookie: string;
  status: 'checking' | 'live' | 'die' | 'unknown' | 'LIVE' | 'COOLING' | 'DEAD' | 'EXHAUSTED' | 'UNKNOWN';
  cooldown_until?: number;
  total_requests_count?: number;
  requests_2_5_flash_count?: number;
  requests_3_5_flash_count?: number;
  quota_reset_at?: number;
}

export interface TranslationSettings {
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
  proxy?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface HistoryItem {
  id: string;
  filename: string;
  timestamp: string;
  status: 'completed' | 'error';
  sourceLang: string;
  targetLang: string;
  rule3Context?: string;
  rule4Output?: string;
  rule5Part1Output?: string;
  rule5Part2Output?: string;
  rule5Output?: string;
  elapsedTime?: number;
}
