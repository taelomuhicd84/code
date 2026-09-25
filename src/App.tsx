import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Upload, Trash2, Play, CheckCircle2, XCircle, Loader2, 
  Settings, UserCheck, RefreshCw, BookOpen, History, Terminal, 
  ChevronRight, Copy, Check, Download, Layers, AlertCircle, Plus, Eye,
  Pause, Square, Languages, Folder
} from 'lucide-react';
import { FileItem, CredentialItem, TranslationSettings, LogEntry, HistoryItem, SRTBlock } from './types';

const formatDuration = (ms: number) => {
  if (!ms || isNaN(ms)) return '0s';
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) {
    return `${totalSecs} giây`;
  }
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins} phút ${secs} giây`;
};

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'sub' | 'role' | 'history' | 'dictionary' | 'setting'>('sub');
  
  // App state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Retrieve current active file contents
  const activeFile = files.find(f => f.id === selectedFileId);
  const [clearRange, setClearRange] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Settings state
  const [settings, setSettings] = useState<TranslationSettings>({
    sourceLang: 'Auto-Detect',
    targetLang: 'Vietnamese',
    chunkLine: 30,
    chunkSession: 5,
    threads: 3,
    requestInterval: 1,
    wordsPerChunk: 500,
    wordTolerance: 50,
    dictionary: localStorage.getItem('vibe_dictionary') || '',
    useCookies: localStorage.getItem('vibe_use_cookies') === 'true',
    cookiesGemini: localStorage.getItem('vibe_cookies_gemini') || '',
    enableDeepThink: localStorage.getItem('vibe_enable_deepthink') !== 'false',
    rule45Model: localStorage.getItem('vibe_rule45_model') || 'gemini-3.5-flash',
    proxy: localStorage.getItem('vibe_proxy') || ''
  });
  
  // Language list state
  const [sourceLanguages, setSourceLanguages] = useState<string[]>(['Auto-Detect', 'English', 'Japanese', 'Chinese', 'Korean', 'Spanish', 'French']);
  const [newSourceLang, setNewSourceLang] = useState('');
  const [targetLanguages, setTargetLanguages] = useState<string[]>(['Vietnamese', 'English', 'Japanese', 'Chinese', 'Spanish', 'French']);
  const [newTargetLang, setNewTargetLang] = useState('');

  // Credentials / Session accounts
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [manualKeys, setManualKeys] = useState('');

  // Cookies states & handlers
  const [cookieStatus, setCookieStatus] = useState<'unknown' | 'checking' | 'live' | 'dead'>('unknown');
  const [cookieCheckError, setCookieCheckError] = useState<string | null>(null);
  const cookieJsonInputRef = useRef<HTMLInputElement>(null);

  const handleCheckCookie = async (val?: string) => {
    const cookieToCheck = val !== undefined ? val : settings.cookiesGemini;
    if (!cookieToCheck || !cookieToCheck.trim()) {
      setCookieStatus('dead');
      setCookieCheckError('Vui lòng nhập hoặc import Cookie __Secure-1PSID trước khi kiểm tra');
      return;
    }
    const cleanCookie = cookieToCheck.trim();
    if (cleanCookie.length < 50) {
      setCookieStatus('dead');
      setCookieCheckError('Độ dài cookie quá ngắn (phải trên 50 ký tự)');
      return;
    }
    setCookieStatus('checking');
    setCookieCheckError(null);
    try {
      const res = await fetch('/api/cookies/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: cleanCookie, proxy: settings.proxy })
      });
      const data = await res.json();
      if (data.status === 'live') {
        setCookieStatus('live');
      } else {
        setCookieStatus('dead');
        setCookieCheckError(data.error || data.details || 'Cookie không hoạt động (DEAD)');
      }
    } catch (err: any) {
      console.error('Check cookie error:', err);
      setCookieStatus('dead');
      setCookieCheckError('Lỗi kết nối mạng khi kiểm tra trạng thái cookie');
    }
  };

  const handleCookieJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        let foundCookie = '';

        // Support array format e.g. [{"name": "__Secure-1PSID", "value": "..."}]
        if (Array.isArray(parsed)) {
          const item = parsed.find(x => x.name === '__Secure-1PSID' || x.key === '__Secure-1PSID');
          if (item) {
            foundCookie = item.value || item.text || '';
          } else {
            // If not found, look for any cookie starting with g.a or containing similar
            const potential = parsed.find(x => x.value && (x.value.startsWith('g.a') || x.value.length > 50));
            if (potential) foundCookie = potential.value;
          }
        } else if (typeof parsed === 'object' && parsed !== null) {
          // Support object format e.g. {"__Secure-1PSID": "..."}
          if (parsed['__Secure-1PSID']) {
            foundCookie = parsed['__Secure-1PSID'];
          } else {
            // Check for nested values or keys containing __Secure-1PSID
            for (const k of Object.keys(parsed)) {
              if (k.includes('__Secure-1PSID') && typeof parsed[k] === 'string') {
                foundCookie = parsed[k];
                break;
              }
            }
          }
        }

        if (foundCookie) {
          const cleanCookie = foundCookie.trim();
          setSettings(prev => ({ ...prev, cookiesGemini: cleanCookie }));
          
          setCookieStatus('checking');
          setCookieCheckError(null);
          
          try {
            const res = await fetch('/api/cookies/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cookie: cleanCookie, proxy: settings.proxy })
            });
            const data = await res.json();
            if (data.status === 'live') {
              setCookieStatus('live');
              alert('🎉 Đã nạp và kiểm tra Cookie thành công: LIVE (Hoạt động tốt)!');
            } else {
              setCookieStatus('dead');
              const errMsg = data.error || data.details || 'Không rõ nguyên nhân';
              setCookieCheckError(errMsg);
              alert(`❌ Đã nạp Cookie nhưng trạng thái là: DEAD (Không hoạt động)\nChi tiết: ${errMsg}`);
            }
          } catch (err: any) {
            console.error('Check cookie error:', err);
            setCookieStatus('dead');
            setCookieCheckError('Lỗi kết nối mạng khi kiểm tra trạng thái cookie');
            alert('❌ Đã nạp Cookie nhưng gặp lỗi kết nối mạng khi kiểm tra trạng thái LIVE/DEAD.');
          }
        } else {
          alert('Không tìm thấy trường __Secure-1PSID trong file JSON.');
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi phân tích file JSON. Vui lòng kiểm tra định dạng.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Episode Dictionary handlers
  const handleExportDic = (file: FileItem) => {
    if (!file.rule3Context || !file.rule3Context.trim()) {
      alert("Bộ từ điển hiện tại trống, không có dữ liệu để xuất.");
      return;
    }
    const subBase = file.name.replace(/\.[^/.]+$/, "");
    const dicFileName = `${subBase}_dic.txt`;
    
    const element = document.createElement("a");
    const blob = new Blob([file.rule3Context], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(blob);
    element.download = dicFileName;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleMultiDicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    let matchCount = 0;
    let failCount = 0;

    for (const rawFile of Array.from(uploadedFiles)) {
      const file = rawFile as File;
      try {
        const baseName = file.name.replace(/\.[^/.]+$/, ""); // e.g. "abc_dic"
        const targetSubBaseName = baseName.toLowerCase().endsWith('_dic') 
          ? baseName.slice(0, -4) 
          : baseName; // e.g. "abc"

        const matchedSub = files.find(f => {
          const subBase = f.name.replace(/\.[^/.]+$/, "");
          return subBase.toLowerCase() === targetSubBaseName.toLowerCase();
        });

        if (!matchedSub) {
          failCount++;
          continue;
        }

        // Parse content of dictionary file
        let content = "";
        if (file.name.endsWith('.txt')) {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target?.result as string || "");
            reader.onerror = () => reject(new Error("Lỗi đọc file txt"));
            reader.readAsText(file);
          });
        } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
          content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (evt) => {
              try {
                const arrayBuffer = evt.target?.result as ArrayBuffer;
                const base64Data = btoa(
                  new Uint8Array(arrayBuffer)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
                );
                const response = await fetch('/api/dictionary/parse-docx', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ base64Data })
                });
                if (!response.ok) throw new Error("Lỗi giải mã file Word");
                const data = await response.json();
                resolve(data.text || "");
              } catch (err) {
                reject(err);
              }
            };
            reader.onerror = () => reject(new Error("Lỗi đọc file Word"));
            reader.readAsArrayBuffer(file);
          });
        } else {
          continue;
        }

        if (content.trim()) {
          // Update the backend
          const res = await fetch('/api/files/update-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: matchedSub.id, rule3Context: content })
          });
          if (res.ok) {
            setFiles(prev => prev.map(f => f.id === matchedSub.id ? { ...f, rule3Context: content } : f));
            matchCount++;
          }
        }
      } catch (err) {
        console.error("Error processing file:", file.name, err);
      }
    }

    alert(`Đã hoàn tất import: Khớp thành công ${matchCount} bộ từ điển tập phim.${failCount > 0 ? ` (Không tìm thấy tập trùng tên: ${failCount})` : ''}`);
    e.target.value = '';
  };

  // Dictionary Tab States & Handlers
  const [isDictionaryParsing, setIsDictionaryParsing] = useState(false);
  const [dictionaryParseError, setDictionaryParseError] = useState<string | null>(null);

  const handleUpdateDictionary = (newDict: string) => {
    setSettings(prev => ({ ...prev, dictionary: newDict }));
    localStorage.setItem('vibe_dictionary', newDict);
  };

  const handleDictionaryFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await parseAndSetDictionaryFile(file);
    e.target.value = '';
  };

  const parseAndSetDictionaryFile = async (file: File) => {
    setIsDictionaryParsing(true);
    setDictionaryParseError(null);
    try {
      if (file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          handleUpdateDictionary(text);
          setIsDictionaryParsing(false);
        };
        reader.onerror = () => {
          setDictionaryParseError("Không thể đọc file text.");
          setIsDictionaryParsing(false);
        };
        reader.readAsText(file);
      } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const base64Data = btoa(
              new Uint8Array(arrayBuffer)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            
            const response = await fetch('/api/dictionary/parse-docx', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64Data })
            });
            
            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error || "Lỗi server khi chuyển đổi Word");
            }
            
            const data = await response.json();
            handleUpdateDictionary(data.text || "");
          } catch (err: any) {
            console.error(err);
            setDictionaryParseError(err.message || "Lỗi khi phân tích file Word.");
          } finally {
            setIsDictionaryParsing(false);
          }
        };
        reader.onerror = () => {
          setDictionaryParseError("Không thể đọc file Word.");
          setIsDictionaryParsing(false);
        };
        reader.readAsArrayBuffer(file);
      } else {
        setDictionaryParseError("Chỉ hỗ trợ file .txt hoặc .docx/.doc");
        setIsDictionaryParsing(false);
      }
    } catch (err: any) {
      console.error(err);
      setDictionaryParseError("Lỗi không xác định khi tải file.");
      setIsDictionaryParsing(false);
    }
  };
  
  // Copy indicators
  const [copiedRule4, setCopiedRule4] = useState(false);
  const [copiedRule5Part1, setCopiedRule5Part1] = useState(false);
  const [copiedRule5Part2, setCopiedRule5Part2] = useState(false);
  const [copiedRule5, setCopiedRule5] = useState(false);

  // Selected history items for batch/multi download
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);

  // Rule 3 Editor state
  const [rule3EditorContent, setRule3EditorContent] = useState('');
  const [isSavingContext, setIsSavingContext] = useState(false);

  // Sync Rule 3 Editor Content when activeFile or selectedFileId changes
  useEffect(() => {
    if (activeFile) {
      setRule3EditorContent(activeFile.rule3Context || '');
    } else {
      setRule3EditorContent('');
    }
  }, [selectedFileId, activeFile?.rule3Context]);

  // Sync settings parameters to localStorage
  useEffect(() => {
    if (settings.useCookies !== undefined) {
      localStorage.setItem('vibe_use_cookies', String(settings.useCookies));
    }
    if (settings.cookiesGemini !== undefined) {
      localStorage.setItem('vibe_cookies_gemini', settings.cookiesGemini);
    }
    if (settings.enableDeepThink !== undefined) {
      localStorage.setItem('vibe_enable_deepthink', String(settings.enableDeepThink));
    }
    if (settings.rule45Model !== undefined) {
      localStorage.setItem('vibe_rule45_model', settings.rule45Model);
    }
    if (settings.proxy !== undefined) {
      localStorage.setItem('vibe_proxy', settings.proxy);
    }
  }, [settings.useCookies, settings.cookiesGemini, settings.enableDeepThink, settings.rule45Model, settings.proxy]);

  // File Picker Ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Poll intervals
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Fetch initial files, logs, and history on mount
  useEffect(() => {
    fetchFiles();
    fetchLogs();
    fetchHistory();
    fetchCredentials();
    
    // Set up auto-refresh when actively translating
    const interval = setInterval(() => {
      fetchLogs();
      fetchFiles();
      fetchHistory();
      fetchCredentials();
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  // Sync isTranslating and isPaused based on active file statuses
  useEffect(() => {
    const active = files.some(f => f.status === 'translating');
    const paused = files.some(f => f.status === 'paused');
    setIsTranslating(active);
    setIsPaused(paused);
  }, [files]);

  // Scroll logs to bottom
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // API Call Helpers
  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
        if (data.files.length > 0 && !selectedFileId) {
          setSelectedFileId(data.files[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching files:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.history) {
        setHistory(data.history);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const fetchCredentials = async () => {
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      if (data.credentials) {
        setCredentials(prev => {
          const isDifferent = prev.length !== data.credentials.length || 
            prev.some((c, idx) => data.credentials[idx] && (
              c.status !== data.credentials[idx].status || 
              c.email !== data.credentials[idx].email || 
              c.keyOrCookie !== data.credentials[idx].keyOrCookie ||
              c.cooldown_until !== data.credentials[idx].cooldown_until
            ));
          if (isDifferent) {
            return data.credentials;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Error fetching credentials:', err);
    }
  };

  const syncCredentials = async (list: CredentialItem[]) => {
    try {
      await fetch('/api/credentials/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: list })
      });
    } catch (err) {
      console.error('Error syncing credentials with backend:', err);
    }
  };

  // Upload SRT files
  const handleSRTUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const filePromises = Array.from(uploadedFiles).map((file: File) => {
      return new Promise<{ name: string; size: string; content: string }>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          resolve({
            name: file.name,
            size: `${sizeMB} MB`,
            content
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(filePromises).then(async parsedFiles => {
      try {
        const response = await fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: parsedFiles })
        });
        const result = await response.json();
        if (result.files) {
          fetchFiles();
          if (result.files.length > 0) {
            setSelectedFileId(result.files[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to upload files:', err);
      }
    });

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Clear specific files or ranges
  const handleClearFiles = async (all = false) => {
    try {
      const payload: { ids?: string[]; range?: string } = {};
      if (all) {
        // Clear everything
      } else if (clearRange.trim()) {
        payload.range = clearRange.trim();
      } else if (selectedFileId) {
        payload.ids = [selectedFileId];
      }

      const res = await fetch('/api/files/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setClearRange('');
        fetchFiles();
        setSelectedFileId(data.files.length > 0 ? data.files[0].id : null);
      }
    } catch (err) {
      console.error('Error clearing files:', err);
    }
  };

  // Delete individual file
  const handleDeleteSingleFile = async (id: string) => {
    try {
      const res = await fetch('/api/files/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] })
      });
      const data = await res.json();
      if (data.success) {
        fetchFiles();
        if (selectedFileId === id) {
          setSelectedFileId(data.files.length > 0 ? data.files[0].id : null);
        }
      }
    } catch (err) {
      console.error('Error deleting file:', err);
    }
  };

  // Run translations
  const handleRunTranslation = async () => {
    const activeFileIds = files.map(f => f.id);
    if (activeFileIds.length === 0) return;

    try {
      await fetch('/api/translate/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: activeFileIds,
          settings,
          credentials
        })
      });
      fetchFiles();
    } catch (err) {
      console.error('Failed to launch translation:', err);
    }
  };

  // Pause translation
  const handlePauseTranslation = async () => {
    const translatingIds = files.filter(f => f.status === 'translating').map(f => f.id);
    if (translatingIds.length === 0) return;

    try {
      await fetch('/api/translate/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: translatingIds })
      });
      fetchFiles();
    } catch (err) {
      console.error('Failed to pause translation:', err);
    }
  };

  // Resume translation
  const handleResumeTranslation = async (fileId?: string) => {
    const ids = fileId ? [fileId] : files.filter(f => f.status === 'paused').map(f => f.id);
    if (ids.length === 0) return;

    try {
      await fetch('/api/translate/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: ids })
      });
      fetchFiles();
    } catch (err) {
      console.error('Failed to resume translation:', err);
    }
  };

  // Stop translation
  const handleStopTranslation = async () => {
    const activeIds = files.filter(f => f.status === 'translating' || f.status === 'paused').map(f => f.id);
    if (activeIds.length === 0) return;

    try {
      await fetch('/api/translate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: activeIds })
      });
      fetchFiles();
    } catch (err) {
      console.error('Failed to stop translation:', err);
    }
  };

  // Parse and sanitize raw input for Gemini API Keys
  const parseAndAddKeys = async (text: string) => {
    const lines = text.split('\n');
    const newCreds: CredentialItem[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let key = '';
      let email = '';

      // 1. Try to find an explicit Gemini key pattern (starts with AIza and has some letters/numbers/symbols)
      const keyMatch = trimmed.match(/(AIza[a-zA-Z0-9_-]{25,})/);
      const emailMatch = trimmed.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);

      if (keyMatch) {
        key = keyMatch[1];
        if (emailMatch) {
          email = emailMatch[1];
        } else {
          email = `Gemini Key (${key.substring(0, 10)}...)`;
        }
      } else {
        // 2. If no clear Gemini key prefix, use robust fallbacks
        if (trimmed.includes('|')) {
          const parts = trimmed.split('|');
          const emailPart = parts.find(p => p.includes('@'));
          if (emailPart) {
            email = emailPart.trim();
            key = parts.filter(p => p !== emailPart).join('|').trim();
          } else {
            email = parts[0].trim();
            key = parts.slice(1).join('|').trim();
          }
        } else if (emailMatch) {
          email = emailMatch[1];
          key = trimmed.replace(email, '').replace(/[\s:|]+/g, '').trim();
        } else {
          key = trimmed;
        }
      }

      // Final sanitization
      key = key.trim();
      if (!key) return;

      if (!email) {
        email = key.startsWith('AIza') 
          ? `Gemini Key (${key.substring(0, 10)}...)`
          : `Key/Cookie #${credentials.length + newCreds.length + 1}`;
      }

      // Avoid adding duplicate keys
      if (credentials.some(c => c.keyOrCookie === key) || newCreds.some(c => c.keyOrCookie === key)) {
        return;
      }

      newCreds.push({
        id: Math.random().toString(36).substring(7),
        email,
        keyOrCookie: key,
        status: 'unknown'
      });
    });

    if (newCreds.length > 0) {
      const updated = [...credentials, ...newCreds];
      // Mark imported ones as checking initially
      setCredentials(updated.map(c => newCreds.some(nc => nc.keyOrCookie === c.keyOrCookie) ? { ...c, status: 'checking' } : c));
      await syncCredentials(updated);

      try {
        const res = await fetch('/api/credentials/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: updated })
        });
        const data = await res.json();
        if (data.credentials) {
          setCredentials(data.credentials);
        }
      } catch (err) {
        console.error('Initial check for imported credentials failed:', err);
        fetchCredentials();
      }
    }
  };

  // Import Credentials from text file
  const handleCredentialUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseAndAddKeys(text);
    };
    reader.readAsText(file);

    if (credentialInputRef.current) credentialInputRef.current.value = '';
  };

  // Check credentials live status
  const handleCheckLive = async () => {
    if (credentials.length === 0) return;

    setCredentials(prev => prev.map(c => ({ ...c, status: 'checking' })));

    try {
      const res = await fetch('/api/credentials/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials })
      });
      const data = await res.json();
      if (data.credentials) {
        setCredentials(data.credentials);
      }
    } catch (err) {
      console.error('Credential check failed:', err);
      setCredentials(prev => prev.map(c => ({ ...c, status: 'unknown' })));
    }
  };

  // Clear system log entries on the backend
  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLogs([]);
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  // Clear historical translation items on the backend
  const handleClearHistory = async () => {
    try {
      const res = await fetch('/api/history/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setHistory([]);
        setSelectedHistoryIds([]);
      }
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  // Direct download handler using fetch to avoid opening new windows or tab authentication issues
  const handleDownloadDirect = async (fileId: string, type: string) => {
    try {
      const response = await fetch(`/api/download/${fileId}/${type}`);
      if (!response.ok) {
        throw new Error('Failed to fetch file content');
      }
      
      const contentDisposition = response.headers.get('content-disposition');
      let filename = 'download';
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches != null && matches[1]) { 
          filename = decodeURIComponent(matches[1].replace(/['"]/g, ''));
        }
      } else {
        if (type === 'rule4_srt') filename = 'Original_Refined.srt';
        else if (type === 'rule5_part1_srt') filename = 'vi_Original.srt';
        else if (type === 'rule5_part2_srt') filename = 'vi_Timeline.srt';
        else if (type === 'word_report') filename = 'VibeTranslated_Report.doc';
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Error downloading file:', err);
      // Fallback in case of fetch errors
      const link = document.createElement('a');
      link.href = `/api/download/${fileId}/${type}`;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Multiple and Batch downloads for completed history logs
  const handleDownloadMultiple = (type: string) => {
    if (selectedHistoryIds.length === 0) return;
    
    selectedHistoryIds.forEach((id, idx) => {
      setTimeout(() => {
        handleDownloadDirect(id, type);
      }, idx * 450); // Stagger to avoid overlapping browser streams
    });
  };

  const handleDownloadAll = (type: string) => {
    const completedHistory = history.filter(h => h.status === 'completed');
    if (completedHistory.length === 0) return;

    completedHistory.forEach((h, idx) => {
      setTimeout(() => {
        handleDownloadDirect(h.id, type);
      }, idx * 450); // Stagger
    });
  };

  // Add custom source or target languages to selection dropdowns
  const handleAddSourceLang = () => {
    if (newSourceLang.trim() && !sourceLanguages.includes(newSourceLang.trim())) {
      setSourceLanguages(prev => [...prev, newSourceLang.trim()]);
      setSettings(prev => ({ ...prev, sourceLang: newSourceLang.trim() }));
      setNewSourceLang('');
    }
  };

  const handleAddTargetLang = () => {
    if (newTargetLang.trim() && !targetLanguages.includes(newTargetLang.trim())) {
      setTargetLanguages(prev => [...prev, newTargetLang.trim()]);
      setSettings(prev => ({ ...prev, targetLang: newTargetLang.trim() }));
      setNewTargetLang('');
    }
  };

  // Helper to copy text to clipboard
  const copyText = (text: string, rule: 'r4' | 'r5' | 'r5p1' | 'r5p2') => {
    navigator.clipboard.writeText(text);
    if (rule === 'r4') {
      setCopiedRule4(true);
      setTimeout(() => setCopiedRule4(false), 2000);
    } else if (rule === 'r5p1') {
      setCopiedRule5Part1(true);
      setTimeout(() => setCopiedRule5Part1(false), 2000);
    } else if (rule === 'r5p2') {
      setCopiedRule5Part2(true);
      setTimeout(() => setCopiedRule5Part2(false), 2000);
    } else {
      setCopiedRule5(true);
      setTimeout(() => setCopiedRule5(false), 2000);
    }
  };

  return (
    <div id="vibetranslator-root" className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
      {/* HEADER BAR */}
      <header id="vibetranslator-header" className="bg-slate-950/80 backdrop-blur-md border-b border-slate-800 py-4 px-6 sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-500 p-2.5 rounded-xl shadow-lg shadow-cyan-500/10">
            <Layers className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              VibeTranslator V2
            </h1>
            <p className="text-xs text-slate-400 font-mono">Multi-Thread Subtitle Studio & Context Engine</p>
          </div>
        </div>

        {/* TAB SWITCHER */}
        <nav id="vibetranslator-nav" className="flex space-x-1 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
          <button
            id="tab-btn-sub"
            onClick={() => setActiveTab('sub')}
            className={`flex items-center space-x-2 px-4.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'sub'
                ? 'bg-slate-800 text-cyan-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Subtitle Studio</span>
          </button>
          
          <button
            id="tab-btn-history"
            onClick={() => setActiveTab('history')}
            className={`flex items-center space-x-2 px-4.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'history'
                ? 'bg-slate-800 text-teal-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <History className="h-4 w-4" />
            <span>History logs</span>
          </button>
          
          <button
            id="tab-btn-dictionary"
            onClick={() => setActiveTab('dictionary')}
            className={`flex items-center space-x-2 px-4.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'dictionary'
                ? 'bg-slate-800 text-purple-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Languages className="h-4 w-4" />
            <span>Dictionary reference</span>
          </button>
          
          <button
            id="tab-btn-setting"
            onClick={() => setActiveTab('setting')}
            className={`flex items-center space-x-2 px-4.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === 'setting'
                ? 'bg-slate-800 text-emerald-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span>Credentials & Settings</span>
          </button>
        </nav>
      </header>

      {/* WORKSPACE CONTENT AREA */}
      <main id="vibetranslator-main" className="flex-1 p-6 max-w-[1600px] w-full mx-auto flex flex-col space-y-6">

        {/* 1. SUBTITLE STUDIO TAB */}
        {activeTab === 'sub' && (
          <div id="sub-tab-content" className="grid grid-cols-1 gap-6">
            
            {/* TOP PANEL: IMPORT, STATUS LIST, RUN, PROGRESS */}
            <section id="sub-top-section" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800/80 pb-5 mb-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full xl:w-auto">
                  <div>
                    <h2 className="text-lg font-bold flex items-center text-slate-200">
                      <Layers className="h-5 w-5 mr-2 text-cyan-400" />
                      Subtitle File Pipeline Manager
                    </h2>
                    <p className="text-sm text-slate-400">Import original files, select items, configure ranges, and coordinate execution</p>
                  </div>
                </div>

                {/* CONTROLS */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* File Upload Trigger */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleSRTUpload}
                    multiple
                    accept=".srt"
                    className="hidden"
                  />
                  <button
                    id="btn-import-srt"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-xl border border-slate-700 text-sm font-medium transition cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-cyan-400" />
                    <span>Import Subtitles</span>
                  </button>

                  {/* Range clear inputs & controls */}
                  <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-xl p-1.5">
                    <input
                      id="input-clear-range"
                      type="text"
                      placeholder="e.g. #1-#5, #3"
                      value={clearRange}
                      onChange={(e) => setClearRange(e.target.value)}
                      className="bg-transparent text-xs text-slate-300 w-28 px-2.5 focus:outline-none"
                    />
                    <button
                      id="btn-clear-range"
                      onClick={() => handleClearFiles(false)}
                      disabled={files.length === 0}
                      className="flex items-center space-x-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-1.5 px-3 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Clear Range</span>
                    </button>
                  </div>

                  {/* Clear all */}
                  <button
                    id="btn-clear-all"
                    onClick={() => handleClearFiles(true)}
                    disabled={files.length === 0}
                    className="bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900/35 p-2.5 rounded-xl transition cursor-pointer disabled:opacity-40"
                    title="Clear All Subtitle Files"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <div className="h-6 w-[1px] bg-slate-800 hidden sm:block" />

                  {/* Run / Resume pipeline button */}
                  <button
                    id="btn-run-translation"
                    onClick={isPaused ? handleResumeTranslation : handleRunTranslation}
                    disabled={files.length === 0 || (isTranslating && !isPaused)}
                    className={`flex items-center space-x-2 px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg transition cursor-pointer ${
                      files.length === 0 || (isTranslating && !isPaused)
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        : 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-cyan-500/10'
                    }`}
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Translating...</span>
                      </>
                    ) : isPaused ? (
                      <>
                        <Play className="h-4 w-4" />
                        <span>Resume Translation</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        <span>Run Translation</span>
                      </>
                    )}
                  </button>

                  {/* Pause button */}
                  {(isTranslating || isPaused) && (
                    <button
                      id="btn-pause-translation"
                      onClick={handlePauseTranslation}
                      disabled={!isTranslating}
                      className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg transition cursor-pointer ${
                        !isTranslating
                          ? 'bg-slate-800/40 text-slate-500 cursor-not-allowed border border-slate-800'
                          : 'bg-amber-600/20 hover:bg-amber-600/35 text-amber-400 border border-amber-500/30'
                      }`}
                      title="Pause Active Translation"
                    >
                      <Pause className="h-4 w-4" />
                      <span>Pause</span>
                    </button>
                  )}

                  {/* Stop button */}
                  {(isTranslating || isPaused) && (
                    <button
                      id="btn-stop-translation"
                      onClick={handleStopTranslation}
                      className="flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg transition cursor-pointer bg-rose-600/20 hover:bg-rose-600/35 text-rose-400 border border-rose-500/30"
                      title="Stop Translation Completely"
                    >
                      <Square className="h-4 w-4" />
                      <span>Stop</span>
                    </button>
                  )}
                </div>
              </div>

              {/* OVERALL PROGRESS PERCENTAGE STRIP */}
              {files.length > 0 && (
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4.5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                      <RefreshCw className={`h-5 w-5 text-cyan-400 ${isTranslating ? 'animate-spin' : ''}`} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-200">Tổng Tiến Độ Dịch (Overall Translation Progress)</div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <p className="text-xs text-slate-400">Tốc độ siêu tốc đa luồng hoạt động tích cực trên tất cả hàng đợi</p>
                        {files.some(f => (f.elapsedTime || 0) > 0) && (
                          <span className="text-[10px] font-mono font-bold text-cyan-400 px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
                            ⏱️ Tổng: {formatDuration(files.reduce((acc, curr) => acc + (curr.elapsedTime || 0), 0))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-md w-full">
                    <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-400 mb-1.5">
                      <span>TIẾN TRÌNH HOÀN THÀNH</span>
                      <span className="text-cyan-400 text-sm">
                        {Math.floor(files.reduce((acc, curr) => acc + (curr.progress || 0), 0) / files.length)}%
                      </span>
                    </div>
                    <div className="bg-slate-950 h-3 rounded-full border border-slate-800/80 overflow-hidden relative">
                      <div
                        className="bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${Math.floor(files.reduce((acc, curr) => acc + (curr.progress || 0), 0) / files.length)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ACTIVE FILE LIST TABLE */}
              {files.length === 0 ? (
                <div className="border-2 border-dashed border-slate-800 rounded-xl p-8 text-center flex flex-col items-center justify-center">
                  <div className="bg-slate-900 p-4 rounded-full mb-3 border border-slate-800">
                    <FileText className="h-8 w-8 text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">No Subtitle Files Imported</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">Import your translation queue with multiple subtitle files to initiate the pipeline</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* LEFT: File lists */}
                  <div className="lg:col-span-7 bg-slate-900/50 border border-slate-800 rounded-xl max-h-[220px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs font-mono bg-slate-950/40">
                          <th className="py-2.5 px-4 font-normal">Index</th>
                          <th className="py-2.5 px-4 font-normal">Filename</th>
                          <th className="py-2.5 px-4 font-normal">Size</th>
                          <th className="py-2.5 px-4 font-normal">Progress</th>
                          <th className="py-2.5 px-4 font-normal text-right">Status</th>
                          <th className="py-2.5 px-4 font-normal text-center w-12">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-sm">
                        {files.map((file, idx) => (
                          <tr
                            key={file.id}
                            onClick={() => setSelectedFileId(file.id)}
                            className={`cursor-pointer transition-colors duration-150 ${
                              selectedFileId === file.id
                                ? 'bg-slate-800/60 hover:bg-slate-800/80 text-cyan-400'
                                : 'hover:bg-slate-800/30'
                            }`}
                          >
                            <td className="py-3 px-4 font-mono text-slate-400 text-xs font-semibold">
                              #{idx + 1}
                            </td>
                            <td className="py-3 px-4 font-medium max-w-[200px] truncate" title={file.name}>
                              {file.name}
                            </td>
                            <td className="py-3 px-4 text-xs font-mono text-slate-500">
                              {file.size}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <div className="flex items-center space-x-2">
                                  <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className="bg-cyan-500 h-1.5 rounded-full"
                                      style={{ width: `${file.progress}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-mono font-semibold text-slate-400">{file.progress}%</span>
                                </div>
                                {file.elapsedTime !== undefined && file.elapsedTime > 0 && (
                                  <span className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center space-x-1">
                                    <span>⏱️ {formatDuration(file.elapsedTime)}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {file.status === 'translating' && (
                                <span className="inline-flex items-center space-x-1.5 bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Dịch...</span>
                                </span>
                              )}
                              {file.status === 'paused' && (
                                <span className="inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <Pause className="h-3 w-3" />
                                  <span>Tạm dừng</span>
                                </span>
                              )}
                              {file.status === 'stopped' && (
                                <span className="inline-flex items-center space-x-1.5 bg-slate-500/15 text-slate-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <Square className="h-2.5 w-2.5 fill-current" />
                                  <span>Đã dừng</span>
                                </span>
                              )}
                              {file.status === 'completed' && (
                                <span className="inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Hoàn thành</span>
                                </span>
                              )}
                              {file.status === 'error' && (
                                <span className="inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <XCircle className="h-3 w-3" />
                                  <span>Lỗi</span>
                                </span>
                              )}
                              {file.status === 'pending' && (
                                <span className="inline-flex items-center bg-slate-800 text-slate-400 px-2 py-1 rounded-full text-xs font-semibold">
                                  <span>Chờ lệnh</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                id={`btn-delete-file-${file.id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSingleFile(file.id);
                                }}
                                className="text-slate-400 hover:text-rose-500 transition-colors p-1.5 hover:bg-slate-800 rounded-lg cursor-pointer"
                                title="Xóa file này"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* RIGHT: Selected File Overview & Overall Progress */}
                  <div className="lg:col-span-5 bg-slate-900/40 border border-slate-800 rounded-xl p-5 flex flex-col justify-between h-[220px]">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wider font-mono text-slate-500">SELECTED JOB DETAILS</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-200 mt-2 truncate max-w-sm">
                        {activeFile ? activeFile.name : 'No file selected'}
                      </h3>
                      {activeFile?.errorMsg && (
                        <p className="text-xs text-rose-400 mt-1 flex items-start">
                          <AlertCircle className="h-3.5 w-3.5 mr-1 flex-shrink-0 mt-0.5" />
                          <span className="truncate">{activeFile.errorMsg}</span>
                        </p>
                      )}
                      {!activeFile?.errorMsg && (
                        <p className="text-xs text-slate-400 mt-1">
                          {activeFile?.blocks?.length || 0} Subtitle nodes · {activeFile?.status === 'completed' ? 'Successfully parsed, refined & translated.' : 'Pending translation batch run.'}
                        </p>
                      )}
                      {activeFile && activeFile.elapsedTime !== undefined && activeFile.elapsedTime > 0 && (
                        <p className="text-xs text-cyan-400 font-mono mt-1 flex items-center space-x-1">
                          <span>⏱️ Thời gian chạy: {formatDuration(activeFile.elapsedTime)}</span>
                        </p>
                      )}
                    </div>

                    {/* Dynamic Progress indicator */}
                    <div className="border-t border-slate-800 pt-4 mt-2">
                      <div className="flex items-center justify-between text-xs text-slate-400 font-mono font-semibold mb-1.5">
                        <span>PIPELINE MASTER PROGRESS</span>
                        <span className="text-cyan-400">
                          {files.length > 0
                            ? `${Math.floor(files.reduce((acc, curr) => acc + (curr.progress || 0), 0) / files.length)}%`
                            : '0%'}
                        </span>
                      </div>
                      <div className="bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800 flex">
                        {files.map((f, i) => (
                          <div
                            key={f.id}
                            style={{ width: `${100 / files.length}%` }}
                            className={`h-full border-r border-slate-950/20 last:border-none transition-all duration-300 ${
                              f.status === 'completed'
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                                : f.status === 'translating'
                                ? 'bg-cyan-500 animate-pulse'
                                : f.status === 'paused'
                                ? 'bg-amber-500 animate-pulse'
                                : f.status === 'stopped'
                                ? 'bg-slate-600'
                                : f.status === 'error'
                                ? 'bg-rose-500'
                                : 'bg-slate-800'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* PAUSE BANNER AT STEP 3 */}
            {activeFile?.status === 'paused' && (
              <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
                <div className="flex items-start space-x-3.5">
                  <div className="bg-amber-500/15 p-2.5 rounded-xl border border-amber-500/30 text-amber-400 shrink-0 mt-0.5 animate-bounce">
                    <AlertCircle className="h-5.5 w-5.5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-300">Đã tạm dừng sau Quy tắc 3 (Bối cảnh & Từ điển)</h4>
                    <p className="text-xs text-slate-300 leading-relaxed mt-1">
                      Hệ thống đã tự động dừng lại sau khi trích xuất bối cảnh của phim <strong>{activeFile.name}</strong> để bạn kiểm duyệt. 
                      Bạn có thể chỉnh sửa bối cảnh trực tiếp tại tab <strong>Dictionary reference</strong>, sau đó nhấn nút tiếp tục để tiến hành Quy tắc 4 & 5.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setActiveTab('dictionary')}
                    className="bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 text-xs font-semibold px-4 py-2 rounded-xl transition cursor-pointer"
                  >
                    Xem & Sửa Bối cảnh
                  </button>
                  <button
                    onClick={() => handleResumeTranslation(activeFile.id)}
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/10 flex items-center space-x-1.5 transition cursor-pointer"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    <span>Tiếp tục chạy (Run Next) 🚀</span>
                  </button>
                </div>
              </div>
            )}

            {/* MIDDLE PANEL: RULE 4, RULE 5 PHẦN 1, VÀ RULE 5 PHẦN 2 SONG SONG */}
            <section id="sub-middle-section" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              
              {/* RULE 4 - ORIGINAL REFINED COLUMN */}
              <div id="rule4-column" className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col h-[520px]">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span className="bg-cyan-500/10 text-cyan-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded flex-shrink-0">Rule 4</span>
                    <h3 className="text-xs font-bold text-slate-300 truncate" title="Hiệu đính phụ đề gốc (Ngôn ngữ gốc)">Hiệu đính gốc (Ngôn ngữ gốc)</h3>
                  </div>
                  {activeFile?.rule4Output && (
                    <button
                      id="btn-copy-rule4"
                      onClick={() => copyText(activeFile.rule4Output || '', 'r4')}
                      className="flex items-center space-x-1 text-[10px] text-slate-400 hover:text-cyan-400 bg-slate-900 border border-slate-800 py-1 px-2 rounded transition cursor-pointer flex-shrink-0"
                    >
                      {copiedRule4 ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Đã copy!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl leading-relaxed whitespace-pre-wrap select-all scrollbar-thin">
                  {activeFile?.rule4Output ? (
                    activeFile.rule4Output
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 font-sans text-center">
                      <FileText className="h-10 w-10 mb-2 opacity-30" />
                      <span className="text-xs">Phụ đề gốc sau hiệu đính sẽ hiển thị tại đây khi chạy</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RULE 5 PART 1 - ORIGINAL TRANSLATED COLUMN */}
              <div id="rule5-part1-column" className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col h-[520px]">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span className="bg-pink-500/10 text-pink-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded flex-shrink-0">Rule 5 P1</span>
                    <h3 className="text-xs font-bold text-slate-300 truncate" title="Bản dịch Việt gốc (Chưa chia dòng)">Dịch gốc (Tiếng Việt)</h3>
                  </div>
                  {activeFile?.rule5Part1Output && (
                    <button
                      id="btn-copy-rule5-part1"
                      onClick={() => copyText(activeFile.rule5Part1Output || '', 'r5p1')}
                      className="flex items-center space-x-1 text-[10px] text-slate-400 hover:text-pink-400 bg-slate-900 border border-slate-800 py-1 px-2 rounded transition cursor-pointer flex-shrink-0"
                    >
                      {copiedRule5Part1 ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Đã copy!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl leading-relaxed whitespace-pre-wrap select-all scrollbar-thin">
                  {activeFile?.rule5Part1Output ? (
                    activeFile.rule5Part1Output
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 font-sans text-center">
                      <FileText className="h-10 w-10 mb-2 opacity-30" />
                      <span className="text-xs">Bản dịch Việt gốc chưa chia tách dòng sẽ hiển thị tại đây khi chạy</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RULE 5 PART 2 - POLISHED TRANSLATED COLUMN */}
              <div id="rule5-part2-column" className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col h-[520px]">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded flex-shrink-0">Rule 5 P2</span>
                    <h3 className="text-xs font-bold text-slate-300 truncate" title="Dịch tối ưu TTS (Phân tách Timeline)">Dịch timeline (Phân tách)</h3>
                  </div>
                  {(activeFile?.rule5Part2Output || activeFile?.rule5Output) && (
                    <button
                      id="btn-copy-rule5-part2"
                      onClick={() => copyText(activeFile.rule5Part2Output || activeFile.rule5Output || '', 'r5p2')}
                      className="flex items-center space-x-1 text-[10px] text-slate-400 hover:text-emerald-400 bg-slate-900 border border-slate-800 py-1 px-2 rounded transition cursor-pointer flex-shrink-0"
                    >
                      {copiedRule5Part2 ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Đã copy!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-xl leading-relaxed whitespace-pre-wrap select-all scrollbar-thin">
                  {activeFile?.rule5Part2Output || activeFile?.rule5Output ? (
                    activeFile.rule5Part2Output || activeFile.rule5Output
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 font-sans text-center">
                      <FileText className="h-10 w-10 mb-2 opacity-30" />
                      <span className="text-xs">Bản dịch phân tách timeline tối ưu cho TTS sẽ hiển thị tại đây khi chạy</span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* BOTTOM PANEL: SYSTEM LOGS TERMINAL & LIVE THREADS */}
            <section id="sub-bottom-section" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col min-h-[300px] h-[380px] resize-y overflow-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center space-x-2">
                  <Terminal className="h-5 w-5 text-slate-400" />
                  <h3 className="text-sm font-bold text-slate-300">System Activity Logs & Live Threads</h3>
                </div>
                <button
                  id="btn-clear-logs"
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="text-xs text-slate-500 hover:text-slate-300 transition cursor-pointer disabled:opacity-30"
                >
                  Clear Terminal Logs
                </button>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
                {/* Live Threads Monitor Panel */}
                <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col overflow-hidden">
                  <h4 className="text-[11px] font-bold text-slate-400 tracking-wider uppercase mb-3 flex items-center justify-between">
                    <span>Active Worker Threads ({activeFile?.threads?.length || 0})</span>
                    {activeFile?.status === 'translating' && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                      </span>
                    )}
                  </h4>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                    {!activeFile?.threads || activeFile.threads.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs text-center p-4">
                        <Layers className="h-6 w-6 mb-1.5 opacity-25" />
                        <span>Threads idle. Start translating to visualize concurrent pipeline execution.</span>
                      </div>
                    ) : (
                      activeFile.threads.map((thread) => (
                        <div key={thread.id} className="bg-slate-950/60 border border-slate-850 rounded-lg p-2 flex items-center justify-between text-[11px] font-mono hover:border-slate-800 transition">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <span className="text-cyan-400 font-bold flex-shrink-0">W#{thread.id}</span>
                            <div className="flex flex-col min-w-0">
                              <span className="text-slate-200 font-sans font-semibold truncate flex items-center space-x-1.5">
                                <span className="truncate">{thread.label ? thread.label : (thread.chunkIndex === -1 ? 'Waiting' : `Chunk #${thread.chunkIndex + 1}/${thread.totalChunks}`)}</span>
                                {(() => {
                                  const keyIndex = credentials.findIndex(c => c.email === thread.apiKey || c.api_key === thread.apiKey || c.keyOrCookie === thread.apiKey);
                                  if (keyIndex !== -1) {
                                    return (
                                      <span className="bg-cyan-500/10 text-cyan-400 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                                        Key #{keyIndex + 1}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </span>
                              <span className="text-[10px] text-slate-500 truncate" title={thread.apiKey}>
                                {thread.apiKey || 'No key'}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end flex-shrink-0 ml-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase ${
                              thread.status === 'processing' ? 'bg-cyan-500/10 text-cyan-400 animate-pulse' :
                              thread.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                              thread.status === 'error' ? 'bg-rose-500/10 text-rose-400' :
                              thread.status === 'paused' ? 'bg-amber-500/10 text-amber-400 animate-pulse' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {thread.status}
                            </span>
                            <span className="text-[9px] text-slate-600 mt-0.5">{thread.lastUpdated}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Console logs output */}
                <div
                  ref={logsContainerRef}
                  className="lg:col-span-7 bg-slate-900/80 border border-slate-800/80 rounded-xl p-4 font-mono text-[11px] overflow-y-auto space-y-1 leading-relaxed select-text flex flex-col scrollbar-thin"
                >
                  {logs.length === 0 ? (
                    <div className="text-slate-600 text-center py-10 font-sans flex-1 flex items-center justify-center">
                      Console terminal ready. Start translation to log real-time API states, rotations and worker steps.
                    </div>
                  ) : (
                    <div className="flex-1">
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-start space-x-2">
                          <span className="text-slate-500 flex-shrink-0 select-text">[{log.timestamp}]</span>
                          <span className={`font-semibold flex-shrink-0 select-text ${
                            log.level === 'success' ? 'text-emerald-400' :
                            log.level === 'error' ? 'text-rose-400' :
                            log.level === 'warning' ? 'text-amber-400' :
                            'text-cyan-400'
                          }`}>
                            {log.level.toUpperCase()}:
                          </span>
                          <span className="text-slate-300 break-all">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* 3. HISTORY LOGS TAB */}
        {activeTab === 'history' && (
          <div id="history-tab-content" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl min-h-[500px] flex flex-col">
            <div className="border-b border-slate-800 pb-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-200 flex items-center">
                  <History className="h-5 w-5 mr-2 text-teal-400" />
                  Historical Translation Logs
                </h2>
                <p className="text-xs text-slate-400">Review, explore, and download previous outputs from subtitle refining activities</p>
              </div>
              <button
                id="btn-clear-history"
                onClick={handleClearHistory}
                disabled={history.length === 0}
                className="text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-1.5 px-3 rounded-lg font-semibold cursor-pointer disabled:opacity-40"
              >
                Clear All History
              </button>
            </div>

            {history.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-600 py-20">
                <History className="h-12 w-12 mb-3 opacity-30 text-slate-400" />
                <p className="font-semibold text-slate-300 text-base">No Historical Entries Recorded</p>
                <p className="text-xs text-slate-500 max-w-sm mt-1">Completed runs of subtitle operations are backed up safely here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1 items-start">
                
                {/* LIST PANEL */}
                <div className="xl:col-span-4 flex flex-col space-y-4">
                  {/* Master Batch Downloads & Checkbox Controls */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="master-history-checkbox"
                          checked={history.filter(h => h.status === 'completed').length > 0 && selectedHistoryIds.length === history.filter(h => h.status === 'completed').length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedHistoryIds(history.filter(h => h.status === 'completed').map(h => h.id));
                            } else {
                              setSelectedHistoryIds([]);
                            }
                          }}
                          className="rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500/20 h-4 w-4 cursor-pointer"
                        />
                        <label htmlFor="master-history-checkbox" className="text-xs font-bold text-slate-300 cursor-pointer select-none">
                          Chọn tất cả ({history.filter(h => h.status === 'completed').length} completed)
                        </label>
                      </div>
                      <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md">
                        Đã chọn: {selectedHistoryIds.length}
                      </span>
                    </div>

                    {/* Batch download actions */}
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold font-mono">Tải file đã chọn:</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handleDownloadMultiple('rule4_srt')}
                          disabled={selectedHistoryIds.length === 0}
                          className="flex items-center justify-center space-x-1 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-cyan-400 border border-cyan-500/20 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                          title="Tải các file đã chọn dạng SRT Hiệu đính gốc (R4)"
                        >
                          <Download className="h-3 w-3" />
                          <span>Hiệu đính (R4)</span>
                        </button>
                        <button
                          onClick={() => handleDownloadMultiple('rule5_part1_srt')}
                          disabled={selectedHistoryIds.length === 0}
                          className="flex items-center justify-center space-x-1 bg-pink-500/10 hover:bg-pink-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-pink-400 border border-pink-500/20 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                          title="Tải các file đã chọn dạng SRT Dịch gốc (R5 P1)"
                        >
                          <Download className="h-3 w-3" />
                          <span>Dịch gốc (P1)</span>
                        </button>
                        <button
                          onClick={() => handleDownloadMultiple('rule5_part2_srt')}
                          disabled={selectedHistoryIds.length === 0}
                          className="flex items-center justify-center space-x-1 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-emerald-400 border border-emerald-500/20 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                          title="Tải các file đã chọn dạng SRT Dịch timeline (R5 P2)"
                        >
                          <Download className="h-3 w-3" />
                          <span>Timeline (P2)</span>
                        </button>
                        <button
                          onClick={() => handleDownloadMultiple('word_report')}
                          disabled={selectedHistoryIds.length === 0}
                          className="flex items-center justify-center space-x-1 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-400 border border-indigo-500/20 px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition"
                          title="Tải các file đã chọn dạng Word .doc Báo cáo"
                        >
                          <Download className="h-3 w-3" />
                          <span>Báo cáo (.doc)</span>
                        </button>
                      </div>

                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold font-mono mt-1.5">Tải hàng loạt (Tất cả):</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handleDownloadAll('rule5_part2_srt')}
                          className="flex items-center justify-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 px-2 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition"
                          title="Tải tất cả các bản dịch timeline"
                        >
                          <Layers className="h-3 w-3 text-emerald-400" />
                          <span>Tải hết Timeline (P2)</span>
                        </button>
                        <button
                          onClick={() => handleDownloadAll('word_report')}
                          className="flex items-center justify-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 px-2 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition"
                          title="Tải tất cả các báo cáo Word"
                        >
                          <Layers className="h-3 w-3 text-indigo-400" />
                          <span>Tải hết Báo cáo (.doc)</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/30 border border-slate-850 rounded-xl overflow-hidden divide-y divide-slate-800">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedFileId(item.id)}
                        className={`p-4 cursor-pointer transition-colors flex items-start space-x-3 ${
                          selectedFileId === item.id ? 'bg-slate-800/80' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        {/* Individual Checkbox */}
                        {item.status === 'completed' && (
                          <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedHistoryIds.includes(item.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedHistoryIds(prev => [...prev, item.id]);
                                } else {
                                  setSelectedHistoryIds(prev => prev.filter(x => x !== item.id));
                                }
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500/20 h-4 w-4 cursor-pointer"
                            />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                              item.status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {item.status === 'completed' ? 'COMPLETED' : 'FAILED'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">{item.timestamp}</span>
                          </div>
                          <h4 className="text-sm font-semibold text-slate-200 truncate" title={item.filename}>
                            {item.filename}
                          </h4>
                          <div className="flex items-center space-x-2 mt-2 text-xs text-slate-400 font-mono">
                            <span>{item.sourceLang}</span>
                            <ChevronRight className="h-3 w-3" />
                            <span>{item.targetLang}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* DETAILS COMPILER */}
                <div className="xl:col-span-8 bg-slate-900/30 border border-slate-850 rounded-xl p-6 flex flex-col min-h-[450px]">
                  {(() => {
                    const activeHist = history.find(h => h.id === selectedFileId);
                    if (!activeHist) {
                      return (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-sm">
                          <Eye className="h-8 w-8 mb-2 opacity-35" />
                          <span>Select a history item on the left to review its generated output</span>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-6 flex-1 flex flex-col">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                          <div>
                            <span className="text-xs font-semibold text-slate-500 font-mono">HISTORY ITEM PREVIEW</span>
                            <h3 className="text-base font-bold text-slate-200 mt-1 max-w-md truncate" title={activeHist.filename}>
                              {activeHist.filename}
                            </h3>
                          </div>
                          
                          {/* DOWNLOADS BUTTONS */}
                          {activeHist.status === 'completed' && (
                            <div className="flex flex-wrap gap-1.5 max-w-[550px]">
                              <button
                                onClick={() => handleDownloadDirect(activeHist.id, 'rule4_srt')}
                                className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
                                title="Tải Hiệu đính gốc bối cảnh (.srt) - Rule 4"
                              >
                                <Download className="h-3 w-3 text-cyan-400" />
                                <span>Hiệu đính gốc (R4)</span>
                              </button>
                              <button
                                onClick={() => handleDownloadDirect(activeHist.id, 'rule5_part1_srt')}
                                className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
                                title="Tải Bản dịch Việt chưa chia dòng (.srt) - Rule 5 P1"
                              >
                                <Download className="h-3 w-3 text-pink-400" />
                                <span>Dịch gốc (R5 P1)</span>
                              </button>
                              <button
                                onClick={() => handleDownloadDirect(activeHist.id, 'rule5_part2_srt')}
                                className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
                                title="Tải Phụ đề Timeline tối ưu TTS (.srt) - Rule 5 P2"
                              >
                                <Download className="h-3 w-3 text-emerald-400" />
                                <span>Dịch timeline (R5 P2)</span>
                              </button>
                              <button
                                onClick={() => handleDownloadDirect(activeHist.id, 'word_report')}
                                className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
                                title="Tải báo cáo Word (.doc)"
                              >
                                <FileText className="h-3 w-3 text-indigo-400" />
                                <span>Báo cáo (.doc)</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* HIST CONTENT VIEW */}
                        <div className="flex-1 overflow-y-auto max-h-[400px] space-y-4 font-sans text-sm text-slate-300">
                          {activeHist.rule3Context && (
                            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4">
                              <h4 className="text-xs font-bold text-indigo-400 tracking-wider mb-2 font-mono">CONSTRAINTS BOOK (RULE 3)</h4>
                              <p className="text-xs font-mono text-slate-400 whitespace-pre-wrap leading-relaxed select-text">{activeHist.rule3Context}</p>
                            </div>
                          )}

                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col h-[280px]">
                              <h5 className="text-xs font-bold text-cyan-400 tracking-wider mb-2 font-mono">HIỆU ĐÍNH GỐC (RULE 4)</h5>
                              <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 whitespace-pre-wrap select-all leading-relaxed scrollbar-thin">
                                {activeHist.rule4Output || 'Trống'}
                              </div>
                            </div>

                            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col h-[280px]">
                              <h5 className="text-xs font-bold text-pink-400 tracking-wider mb-2 font-mono">DỊCH GỐC (RULE 5 P1)</h5>
                              <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 whitespace-pre-wrap select-all leading-relaxed scrollbar-thin">
                                {activeHist.rule5Part1Output || 'Trống'}
                              </div>
                            </div>

                            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col h-[280px]">
                              <h5 className="text-xs font-bold text-emerald-400 tracking-wider mb-2 font-mono">DỊCH TIMELINE (RULE 5 P2)</h5>
                              <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-400 whitespace-pre-wrap select-all leading-relaxed scrollbar-thin">
                                {activeHist.rule5Part2Output || activeHist.rule5Output || 'Trống'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DICTIONARY REFERENCE TAB */}
        {activeTab === 'dictionary' && (
          <div id="dictionary-tab-content" className="grid grid-cols-1 gap-6">
            <section id="dictionary-main-card" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col">
              <div className="border-b border-slate-800 pb-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-200 flex items-center">
                    <Languages className="h-5 w-5 mr-2 text-purple-400" />
                    Bối cảnh & Từ điển Tham chiếu (Dictionary & Movie Context)
                  </h2>
                  <p className="text-xs text-slate-400 font-sans mt-1">
                    Cung cấp danh sách nhân vật, bối cảnh, xưng hô để định hướng dịch thô (Quy tắc 3) và cho phép chỉnh sửa bối cảnh đã phân tích.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* LEFT PANEL: DICTIONARY INPUT */}
                <div className="flex flex-col space-y-5 border-r border-slate-900 pr-0 xl:pr-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-300 flex items-center">
                      <FileText className="h-4 w-4 mr-2 text-purple-400" />
                      Từ điển Tham chiếu Gốc
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          if (navigator.clipboard) {
                            navigator.clipboard.writeText(settings.dictionary || "");
                            alert("Đã sao chép bộ từ điển vào bộ nhớ tạm.");
                          }
                        }}
                        className="flex items-center space-x-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2 py-1 rounded text-xs transition cursor-pointer"
                        title="Copy từ điển"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Bạn có chắc chắn muốn xóa toàn bộ từ điển tham chiếu hiện tại?")) {
                            handleUpdateDictionary("");
                          }
                        }}
                        className="flex items-center space-x-1 bg-slate-900 hover:bg-red-950/20 text-red-400 border border-slate-800 hover:border-red-900/30 px-2 py-1 rounded text-xs transition cursor-pointer"
                        title="Xóa từ điển"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <textarea
                      id="dictionary-textarea"
                      value={settings.dictionary || ""}
                      onChange={(e) => handleUpdateDictionary(e.target.value)}
                      placeholder={`Ví dụ mẫu bộ từ điển:
Trần Trác: Chàng trai bị bệnh tâm thần (ngôn ngữ gốc: 陈卓 / 陈策)
Bệnh viện Hàn Châu: Nơi điều trị của Trần Trác (ngôn ngữ gốc: 杭州医院)
Thông thiên lục: Bí tịch võ học cổ xưa giúp thông đạt quỷ thần`}
                      className="w-full h-[280px] bg-slate-900/40 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 placeholder-slate-650 focus:outline-none focus:border-purple-500/60 font-sans leading-relaxed scrollbar-thin resize-none"
                    />
                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                      <span>{(settings.dictionary || "").split('\n').filter(Boolean).length} hàng</span>
                      <span>{(settings.dictionary || "").length} ký tự</span>
                    </div>
                  </div>

                  {/* Row of Episode Dictionary files */}
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                        <Folder className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Danh sách bộ từ điển theo tập (_dic)</span>
                      </div>
                      
                      {/* Button to import multiple dic files */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="file"
                          id="input-multi-dic"
                          multiple
                          accept=".txt,.docx,.doc"
                          onChange={handleMultiDicUpload}
                          className="hidden"
                        />
                        <button
                          onClick={() => document.getElementById('input-multi-dic')?.click()}
                          className="flex items-center space-x-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer"
                        >
                          <Upload className="h-3 w-3" />
                          <span>Import Từ điển (_dic)</span>
                        </button>

                        {/* Export active dic button */}
                        {activeFile && (
                          <button
                            onClick={() => handleExportDic(activeFile)}
                            className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer"
                            title="Xuất từ điển hiện tại"
                          >
                            <Download className="h-3 w-3" />
                            <span>Xuất File (*_dic.txt)</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {files.length === 0 ? (
                      <p className="text-[11px] text-slate-500">Chưa có tập phim nào để ánh xạ bộ từ điển.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 max-h-[110px] overflow-y-auto scrollbar-thin p-1">
                        {files.map(f => {
                          const subBase = f.name.replace(/\.[^/.]+$/, "");
                          const dicName = `${subBase}_dic`;
                          const hasContent = f.rule3Context && f.rule3Context.trim().length > 0;
                          const isSelected = selectedFileId === f.id;
                          return (
                            <button
                              key={f.id}
                              onClick={() => setSelectedFileId(f.id)}
                              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all border text-left cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-550/20 text-indigo-300 border-indigo-500/50 font-bold'
                                  : hasContent
                                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30 hover:bg-emerald-950/35'
                                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:bg-slate-850'
                              }`}
                              title={f.name}
                            >
                              <FileText className={`h-3.5 w-3.5 ${isSelected ? 'text-indigo-400' : hasContent ? 'text-emerald-400' : 'text-slate-500'}`} />
                              <div className="truncate max-w-[150px]">{dicName}</div>
                              {hasContent && (
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Đã có nội dung" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* RIGHT PANEL: GENERATED MOVIE CONTEXT (Quy tắc 3) */}
                <div className="flex flex-col space-y-5 pt-6 xl:pt-0 pl-0 xl:pl-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <h3 className="text-sm font-bold text-slate-350 flex items-center">
                      <BookOpen className="h-4 w-4 mr-2 text-indigo-400" />
                      Bối cảnh Phim (Quy tắc 3) của Tập Phim
                    </h3>
                    
                    {/* File Dropdown Selector */}
                    {files.length > 0 && (
                      <select
                        value={selectedFileId || ''}
                        onChange={(e) => setSelectedFileId(e.target.value || null)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-semibold focus:outline-none"
                      >
                        {files.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {!activeFile ? (
                    <div className="h-[430px] border border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-center p-6 text-slate-600">
                      <BookOpen className="h-10 w-10 mb-2 opacity-25" />
                      <p className="text-xs font-semibold text-slate-400">Không có file subtitle nào hoạt động</p>
                      <p className="text-[11px] text-slate-500 max-w-xs mt-1">
                        Hãy quay lại tab Subtitle Studio để import file phụ đề trước khi cấu hình bối cảnh.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col space-y-3 flex-1">
                      {/* Active File info and status */}
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/40 border border-slate-850 p-3 rounded-xl">
                        <div className="min-w-0">
                          <span className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Tập phim hiện tại:</span>
                          <h4 className="text-xs font-bold text-slate-300 truncate" title={activeFile.name}>
                            {activeFile.name}
                          </h4>
                        </div>
                        
                        {/* Status badges */}
                        <div className="shrink-0">
                          {activeFile.status === 'paused' && (
                            <span className="inline-flex items-center space-x-1 bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/25 animate-pulse">
                              <span>⚠️ Chờ duyệt bối cảnh</span>
                            </span>
                          )}
                          {activeFile.status === 'translating' && (
                            <span className="inline-flex items-center space-x-1 bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-500/25 animate-pulse">
                              <span>⏳ Đang dịch</span>
                            </span>
                          )}
                          {activeFile.status === 'completed' && (
                            <span className="inline-flex items-center space-x-1 bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-500/25">
                              <span>🟢 Đã hoàn thành</span>
                            </span>
                          )}
                          {activeFile.status === 'pending' && (
                            <span className="inline-flex items-center space-x-1 bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full text-[10px] font-bold border border-slate-750">
                              <span>Chờ dịch</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Rule 3 Editor textarea */}
                      <textarea
                        value={rule3EditorContent}
                        onChange={(e) => setRule3EditorContent(e.target.value)}
                        placeholder={`Mô tả bối cảnh, vai trò nhân vật và cách xưng hô sẽ tự động được trích xuất tại đây sau Quy tắc 3.
Bạn cũng có thể dán trực tiếp hoặc sửa đổi nội dung này thủ công rồi bấm "Lưu thay đổi".`}
                        className="w-full h-[260px] bg-slate-900/40 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 placeholder-slate-650 focus:outline-none focus:border-indigo-500/60 font-mono leading-relaxed scrollbar-thin resize-none"
                      />

                      {/* Rule 3 Edit Action buttons */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div className="text-[10px] text-slate-500 font-mono">
                          {rule3EditorContent.length} ký tự
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              if (!selectedFileId) return;
                              setIsSavingContext(true);
                              try {
                                const res = await fetch('/api/files/update-context', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ fileId: selectedFileId, rule3Context: rule3EditorContent })
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setFiles(prev => prev.map(f => f.id === selectedFileId ? { ...f, rule3Context: rule3EditorContent } : f));
                                  alert("Đã lưu bối cảnh thành công!");
                                } else {
                                  alert("Lỗi khi lưu bối cảnh: " + (data.error || "Không rõ nguyên nhân"));
                                }
                              } catch (err) {
                                console.error(err);
                                alert("Lỗi mạng khi lưu bối cảnh");
                              } finally {
                                setIsSavingContext(false);
                              }
                            }}
                            disabled={isSavingContext}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer flex items-center space-x-1"
                          >
                            {isSavingContext ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Đang lưu...</span>
                              </>
                            ) : (
                              <span>Lưu thay đổi bối cảnh</span>
                            )}
                          </button>

                          {activeFile.status === 'paused' && (
                            <button
                              onClick={() => handleResumeTranslation(activeFile.id)}
                              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-extrabold px-4 py-2 rounded-xl shadow-lg shadow-emerald-500/10 flex items-center space-x-1 transition cursor-pointer animate-pulse"
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                              <span>Tiếp tục chạy (Run Next) 🚀</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* 4. CREDENTIALS & SETTINGS TAB */}
        {activeTab === 'setting' && (
          <div id="setting-tab-content" className="grid grid-cols-1 gap-6">
            
            {/* TOP SECTION: PARAMETERS CONFIGURATION */}
            <section id="setting-top-section" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="border-b border-slate-800 pb-3 mb-5">
                <h2 className="text-lg font-bold text-slate-200 flex items-center">
                  <Settings className="h-5 w-5 mr-2 text-emerald-400" />
                  Translation parameters and languages
                </h2>
                <p className="text-xs text-slate-400 font-sans">Set limits for subtitle lines per chunk, worker threads, and dynamic localization targets</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                {/* 1. Source Language */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-source-lang" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Source Language</label>
                  <select
                    id="select-source-lang"
                    value={settings.sourceLang}
                    onChange={(e) => setSettings(prev => ({ ...prev, sourceLang: e.target.value }))}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {sourceLanguages.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                  <div className="flex space-x-1 mt-1">
                    <input
                      id="input-new-source-lang"
                      type="text"
                      placeholder="Add language..."
                      value={newSourceLang}
                      onChange={(e) => setNewSourceLang(e.target.value)}
                      className="bg-slate-900/50 border border-slate-850 rounded-lg text-xs px-2 py-1 flex-1 focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      id="btn-add-source-lang"
                      onClick={handleAddSourceLang}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1 rounded-lg text-xs cursor-pointer"
                    >
                      <Plus className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>

                {/* 2. Target Language */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-target-lang" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Translate To</label>
                  <select
                    id="select-target-lang"
                    value={settings.targetLang}
                    onChange={(e) => setSettings(prev => ({ ...prev, targetLang: e.target.value }))}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {targetLanguages.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                  <div className="flex space-x-1 mt-1">
                    <input
                      id="input-new-target-lang"
                      type="text"
                      placeholder="Add language..."
                      value={newTargetLang}
                      onChange={(e) => setNewTargetLang(e.target.value)}
                      className="bg-slate-900/50 border border-slate-850 rounded-lg text-xs px-2 py-1 flex-1 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      id="btn-add-target-lang"
                      onClick={handleAddTargetLang}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1 rounded-lg text-xs cursor-pointer"
                    >
                      <Plus className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>

                {/* 3. Chunkline size */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-chunk-line" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chunkline Size</label>
                  <input
                    id="input-chunk-line"
                    type="number"
                    value={settings.chunkLine || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, chunkLine: isNaN(val) ? 0 : val }));
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">Number of subtitle frames per parallel chunk</span>
                </div>

                {/* 4. Chunk/Session size */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-chunk-session" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chunk/Session</label>
                  <input
                    id="input-chunk-session"
                    type="number"
                    value={settings.chunkSession || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, chunkSession: isNaN(val) ? 0 : val }));
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">Batch limits of chunks parsed per operation</span>
                </div>

                {/* 5. Concurrency threads */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-thread-count" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Concurrency threads</label>
                  <select
                    id="select-thread-count"
                    value={settings.threads}
                    onChange={(e) => setSettings(prev => ({ ...prev, threads: parseInt(e.target.value) }))}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <option key={n} value={n}>{n} Thread{n > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-500 font-sans">Active parallel worker threads (Capped at 10)</span>
                </div>

                {/* 6. Request Interval */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-request-interval" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Giãn cách yêu cầu (giây)</label>
                  <input
                    id="input-request-interval"
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="1"
                    value={settings.requestInterval ?? ''}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSettings(prev => ({ ...prev, requestInterval: isNaN(val) ? undefined : val }));
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">Thời gian giãn cách giữa các yêu cầu của từng luồng (giây)</span>
                </div>

                {/* 7. Words Per Chunk */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-words-per-chunk" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Số từ mỗi luồng (Rule 1 & 2)</label>
                  <input
                    id="input-words-per-chunk"
                    type="number"
                    min="1"
                    placeholder="500"
                    value={settings.wordsPerChunk ?? ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, wordsPerChunk: isNaN(val) ? undefined : val }));
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">Mục tiêu số lượng từ cần dịch cho mỗi luồng chạy</span>
                </div>

                {/* 8. Word Tolerance */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-word-tolerance" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sai số từ cho phép</label>
                  <input
                    id="input-word-tolerance"
                    type="number"
                    min="0"
                    placeholder="50"
                    value={settings.wordTolerance ?? ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, wordTolerance: isNaN(val) ? undefined : val }));
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-500 font-sans">Khoảng sai lệch số từ để cố định lấy hết dấu chấm câu kết thúc</span>
                </div>

                {/* 9. Gemini Web Model Selector (Rule 3 Playwright) */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-gemini-model-mode" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mô hình Gemini Web (Rule 3)</label>
                  <select
                    id="select-gemini-model-mode"
                    value={settings.enableDeepThink !== false ? 'deepthink' : 'standard'}
                    onChange={(e) => setSettings(prev => ({ ...prev, enableDeepThink: e.target.value === 'deepthink' }))}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-cyan-400 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="deepthink">🧠 3.1 Pro (Deep Think)</option>
                    <option value="standard">⚡ 3.1 Pro (Đơn thuần)</option>
                  </select>
                  <span className="text-[10px] text-slate-500 font-sans">Chọn giữa 3.1 Pro đơn thuần hoặc 3.1 Pro kèm suy luận sâu Deep Think</span>
                </div>

                {/* 10. Gemini API Model Selector (Rule 4 & 5) */}
                <div className="flex flex-col space-y-2">
                  <label id="lbl-gemini-rule45-model" className="text-xs font-bold text-slate-400 uppercase tracking-wider">Model API Gemini (Rule 4 & 5)</label>
                  <select
                    id="select-gemini-rule45-model"
                    value={settings.rule45Model || 'gemini-3.5-flash'}
                    onChange={(e) => setSettings(prev => ({ ...prev, rule45Model: e.target.value }))}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-amber-400 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash</option>
                    <option value="gemini-3.5-flash">🚀 Gemini 3.5 Flash</option>
                    <option value="gemini-3.6-flash">🔥 Gemini 3.6 Flash</option>
                  </select>
                  <span className="text-[10px] text-slate-500 font-sans">Mô hình API Gemini xử lý tinh chỉnh & dịch chính thức Rule 4 & 5</span>
                </div>
              </div>
            </section>

            {/* MIDDLE SECTION: GEMINI COOKIES CONFIG FOR RULE 3 */}
            <section id="setting-cookies-section" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="border-b border-slate-800 pb-3 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-200 flex items-center">
                    <Layers className="h-5 w-5 mr-2 text-indigo-400" />
                    Cấu hình Cookies & MMO Browser (Quy tắc 3)
                  </h2>
                  <p className="text-xs text-slate-400 font-sans mt-0.5">Dán giá trị Cookie __Secure-1PSID hoặc nạp từ file JSON để xác thực phiên trình duyệt Playwright</p>
                </div>

                {/* Cookie live status with green check or red cross */}
                <div className="shrink-0 flex items-center space-x-2">
                  {cookieStatus === 'checking' && (
                    <span className="inline-flex items-center space-x-1.5 bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-500/25">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Đang kiểm tra cookie...</span>
                    </span>
                  )}
                  {cookieStatus === 'live' && (
                    <span className="inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-500/25 shadow-lg shadow-emerald-500/5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>Cookie LIVE (Hoạt động tốt)</span>
                    </span>
                  )}
                  {cookieStatus === 'dead' && (
                    <span className="inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-rose-500/25">
                      <XCircle className="h-4 w-4 text-rose-400" />
                      <span>Cookie DEAD / Không hợp lệ</span>
                    </span>
                  )}
                  {cookieStatus === 'unknown' && (
                    <span className="inline-flex items-center space-x-1.5 bg-slate-900 text-slate-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-800">
                      <span>Chưa kiểm tra</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* JSON Import area */}
                <div className="lg:col-span-4 bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider mb-1.5 flex items-center">
                      <Upload className="h-3.5 w-3.5 mr-1.5 text-indigo-400" />
                      Nhập Cookie từ File JSON
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Bạn có thể xuất cookie bằng các tiện ích mở rộng của Chrome (như J2TEAM Cookies, EditThisCookie) dưới định dạng JSON rồi tải lên tại đây.
                    </p>
                  </div>
                  
                  <div className="pt-2">
                    <input
                      type="file"
                      ref={cookieJsonInputRef}
                      onChange={handleCookieJsonUpload}
                      accept=".json"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => cookieJsonInputRef.current?.click()}
                      className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Import File JSON Cookie</span>
                    </button>
                  </div>
                </div>

                {/* Input Fields for Cookies & Profile Path */}
                <div className="lg:col-span-8 space-y-4">
                  {/* Rule 3 Method selection */}
                  <div className="flex flex-col space-y-2">
                    <label htmlFor="select-rule3-method" className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                      <span>Phương pháp Quy tắc 3 (Rule 3 Method)</span>
                      <span className="text-[10px] text-slate-500 font-normal normal-case ml-2">(Phương thức trích xuất bối cảnh phim)</span>
                    </label>
                    <select
                      id="select-rule3-method"
                      value={settings.useCookies ? 'cookies' : 'api'}
                      onChange={(e) => setSettings(prev => ({ ...prev, useCookies: e.target.value === 'cookies' }))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-cyan-400 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="api">🚀 Gemini API (Thông thường)</option>
                      <option value="cookies">🍪 Cookies Gemini (Playwright {settings.enableDeepThink !== false ? '3.1 Pro Deep Think' : '3.1 Pro'})</option>
                    </select>
                    <span className="text-[10px] text-slate-500 font-sans leading-relaxed">
                      Lựa chọn "Cookies Gemini" để tự động mô phỏng trình duyệt tương tác với giao diện Web Gemini nhằm vượt qua giới hạn của API thông thường.
                    </span>
                  </div>

                  {/* Cookies String input */}
                  <div className="flex flex-col space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="input-cookies-gemini" className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                        <span>Nội dung Cookie __Secure-1PSID</span>
                        <span className="text-[10px] text-slate-500 font-normal normal-case ml-2">(Phiên đăng nhập trực tiếp)</span>
                      </label>
                      
                      <button
                        type="button"
                        onClick={() => handleCheckCookie()}
                        disabled={cookieStatus === 'checking'}
                        className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition cursor-pointer flex items-center space-x-1"
                      >
                        <RefreshCw className={`h-3 w-3 ${cookieStatus === 'checking' ? 'animate-spin' : ''}`} />
                        <span>Kiểm tra trạng thái Cookie</span>
                      </button>
                    </div>

                    <textarea
                      id="input-cookies-gemini"
                      rows={2}
                      placeholder="Dán giá trị Cookie __Secure-1PSID tại đây..."
                      value={settings.cookiesGemini || ''}
                      onChange={(e) => {
                        setSettings(prev => ({ ...prev, cookiesGemini: e.target.value }));
                        setCookieStatus('unknown');
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4.5 py-2.5 text-xs text-slate-200 font-mono placeholder:text-slate-650 focus:outline-none focus:border-indigo-500 resize-none"
                    />

                    {cookieCheckError && (
                      <p className="text-[11px] text-rose-400 font-sans mt-1">⚠️ {cookieCheckError}</p>
                    )}
                  </div>

                  {/* Proxy String input */}
                  <div className="flex flex-col space-y-2">
                    <label htmlFor="input-proxy-gemini" className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                      <span>Cấu hình Proxy (Socks5/HTTP)</span>
                      <span className="text-[10px] text-slate-500 font-normal normal-case ml-2">(Bắt buộc phải chạy cùng proxy lúc lấy cookie)</span>
                    </label>
                    <input
                      id="input-proxy-gemini"
                      type="text"
                      placeholder="e.g. socks5://127.0.0.1:4000 (Để trống nếu muốn dùng mạng trực tiếp của máy)"
                      value={settings.proxy || ''}
                      onChange={(e) => setSettings(prev => ({ ...prev, proxy: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4.5 py-2.5 text-sm text-slate-200 font-mono placeholder:text-slate-650 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-[10px] text-slate-500 font-sans leading-relaxed">
                      Nhập địa chỉ proxy để định tuyến trình duyệt ẩn danh Playwright. Hỗ trợ các giao thức HTTP, SOCKS4, SOCKS5 (Ví dụ: <code>socks5://127.0.0.1:4000</code>).
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* BOTTOM SECTION: GEMINI API KEYS POOL */}
            <section id="setting-bottom-section" className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-200 flex items-center">
                    <UserCheck className="h-5 w-5 mr-2 text-emerald-400" />
                    Gemini API Keys Pool Manager
                  </h2>
                  <p className="text-xs text-slate-400">Configure multiple official Google Gemini API Keys starting with "AIza..." to rotate and speed up concurrency.</p>
                </div>

                {/* ACCOUNT CONTROLS */}
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    ref={credentialInputRef}
                    onChange={handleCredentialUpload}
                    accept=".txt"
                    className="hidden"
                  />
                  <button
                    id="btn-import-credentials"
                    onClick={() => credentialInputRef.current?.click()}
                    className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition"
                  >
                    <Upload className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Import File (.txt)</span>
                  </button>

                  <button
                    id="btn-check-live"
                    onClick={handleCheckLive}
                    disabled={credentials.length === 0}
                    className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Check Live Status</span>
                  </button>

                  <button
                    id="btn-reload-credentials"
                    onClick={() => {
                      setCredentials([]);
                      syncCredentials([]);
                    }}
                    disabled={credentials.length === 0}
                    className="text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-900/30 p-2 rounded-xl transition cursor-pointer"
                    title="Reset All Loaded Keys"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* TWO INPUT METHODS PANEL */}
              <div className="bg-slate-900/40 border border-slate-850 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-300">Method 1: Direct Text Copy-Paste Input</h3>
                <div className="space-y-3">
                  <textarea
                    rows={4}
                    placeholder="Paste Gemini API Keys here (one key per line)&#10;Keys must start with 'AIza...'"
                    value={manualKeys}
                    onChange={(e) => setManualKeys(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        if (!manualKeys.trim()) return;
                        parseAndAddKeys(manualKeys);
                        setManualKeys('');
                      }}
                      disabled={!manualKeys.trim()}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
                    >
                      Import manual keys
                    </button>
                  </div>
                </div>
              </div>

              {/* CREDENTIALS TABLE */}
              {credentials.length === 0 ? (
                <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center flex flex-col items-center justify-center">
                  <div className="bg-slate-900 p-3.5 rounded-full mb-3 border border-slate-800">
                    <UserCheck className="h-6 w-6 text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">No Custom Gemini Keys Loaded</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    System will automatically fallback to utilize our backend API Key (GEMINI_API_KEY). Paste or upload a .txt list starting with "AIza..." to enable pool rotation.
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-xs font-mono bg-slate-950/40">
                        <th className="py-2.5 px-4 font-normal">API Key Index</th>
                        <th className="py-2.5 px-4 font-normal">Live status</th>
                        <th className="py-2.5 px-4 font-normal">Identifier</th>
                        <th className="py-2.5 px-4 font-normal">Gemini 2.5 Flash (Today)</th>
                        <th className="py-2.5 px-4 font-normal">Gemini 3.5 Flash (Today)</th>
                        <th className="py-2.5 px-4 font-normal">Gemini API Key String</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-xs leading-relaxed">
                      {credentials.map((cred, i) => (
                        <tr key={cred.id} className="hover:bg-slate-800/20">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-400">
                            #{i + 1}
                          </td>
                          <td className="py-3 px-4 font-semibold">
                            {(cred.status === 'live' || cred.status === 'LIVE') && (
                              <span className="inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                                <span>🟢 LIVE</span>
                              </span>
                            )}
                            {(cred.status === 'die' || cred.status === 'DEAD') && (
                              <span className="inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                                <span>🔴 DEAD</span>
                              </span>
                            )}
                            {cred.status === 'COOLING' && (
                              <span className="inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                                <span>⏳ COOLING {cred.cooldown_until ? `(${Math.max(0, Math.ceil((cred.cooldown_until - Date.now()) / 1000))}s)` : ''}</span>
                              </span>
                            )}
                            {cred.status === 'EXHAUSTED' && (
                              <span className="inline-flex items-center space-x-1.5 bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded-full text-[10px] font-bold" title={cred.cooldown_until ? `Mở khoá: ${new Date(cred.cooldown_until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : ''}>
                                <span>😴 EXHAUSTED {cred.cooldown_until ? `(${Math.max(0, Math.ceil((cred.cooldown_until - Date.now()) / 3600000))}h left)` : ''}</span>
                              </span>
                            )}
                            {cred.status === 'checking' && (
                              <span className="inline-flex items-center space-x-1.5 bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                <span>Checking</span>
                              </span>
                            )}
                            {(cred.status === 'unknown' || cred.status === 'UNKNOWN') && (
                              <span className="inline-flex items-center bg-slate-800 text-slate-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                                <span>⚪ Untested</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-300">
                            {cred.email}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-300">
                            <span className="text-cyan-400 font-bold">{cred.requests_2_5_flash_count || 0}</span>
                            <span className="text-slate-500 font-normal"> / 20</span>
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-300">
                            <span className="text-indigo-400 font-bold">{cred.requests_3_5_flash_count || 0}</span>
                            <span className="text-slate-500 font-normal"> / 20</span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 font-mono truncate max-w-[250px]" title={cred.keyOrCookie}>
                            {cred.keyOrCookie}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer id="vibetranslator-footer" className="bg-slate-950/60 border-t border-slate-900 py-4 px-6 mt-12 text-center text-xs text-slate-500 font-mono">
        <div>VibeTranslator V2 Engine · Built on Google GenAI SDK · Running on port 3000</div>
      </footer>
    </div>
  );
}
