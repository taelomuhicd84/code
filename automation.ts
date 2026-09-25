import { chromium } from "playwright-extra";
import { BrowserContext, Page } from "playwright";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";

// Apply stealth plugin
chromium.use(stealthPlugin());

export interface PlaywrightOptions {
  cookies?: string; // Raw cookie string or individual __Secure-1PSID cookie
  profilePath?: string; // Deprecated - kept for structure compatibility
  timeoutMs?: number; // Total timeout, default 5 mins
  proxy?: string; // User proxy e.g. socks5://127.0.0.1:4000
  enableDeepThink?: boolean; // Whether to enable Deep Think mode (default true)
}

/**
 * Robust helper to parse cookie strings into Playwright-compatible cookie objects
 */
function parseCookies(cookieStr: string): any[] {
  if (!cookieStr) return [];
  
  // If it's a JSON array of cookies, parse it directly
  if (cookieStr.trim().startsWith("[")) {
    try {
      return JSON.parse(cookieStr);
    } catch (e) {
      // Fallback to text parsing
    }
  }

  const cookies: any[] = [];
  const pairs = cookieStr.split(";");
  
  for (const p of pairs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    
    const index = trimmed.indexOf("=");
    if (index === -1) {
      // Single cookie value assumed to be __Secure-1PSID
      cookies.push({
        name: "__Secure-1PSID",
        value: trimmed,
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: true
      });
    } else {
      const name = trimmed.substring(0, index).trim();
      const value = trimmed.substring(index + 1).trim();
      cookies.push({
        name,
        value,
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: true
      });
    }
  }
  
  // Ensure we at least have __Secure-1PSID mapped to google.com if not already specified
  const hasSecure1PSID = cookies.some(c => c.name === "__Secure-1PSID");
  if (!hasSecure1PSID && cookies.length > 0) {
    // If user just pasted a single key that doesn't contain '=', treat the whole string as __Secure-1PSID
    const firstCookie = cookies[0];
    if (firstCookie.name && !firstCookie.value) {
      firstCookie.value = firstCookie.name;
      firstCookie.name = "__Secure-1PSID";
      firstCookie.domain = ".google.com";
      firstCookie.path = "/";
    }
  }

  return cookies;
}

/**
 * Runs Rule 3 via Playwright on gemini.google.com using Gemini 3.1 Pro Deep Think
 */
export async function runGeminiCookiesRule3(
  prompt: string,
  options: PlaywrightOptions,
  onLog: (msg: string) => void
): Promise<string> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const timeoutMs = options.timeoutMs || 300000; // 5 mins

  onLog("Initializing Playwright browser context...");

  try {
    const launchOptions: any = {
      headless: true, // Run headlessly in the background
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--use-fake-ui-for-media-stream",
        "--disable-infobars"
      ]
    };

    if (options.proxy && options.proxy.trim()) {
      onLog(`Using Proxy configuration: ${options.proxy.trim()}`);
      launchOptions.proxy = { server: options.proxy.trim() };
    }

    onLog("Launching standard Chromium instance with stealth protection...");
    const browser = await chromium.launch(launchOptions);
    context = await browser.newContext();

    // Set stealth headers to look like a standard browser
    await context.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9,vi;q=0.8"
    });

    page = await context.newPage();
    page.setDefaultTimeout(60000); // 1 min navigation default

    // If cookies are provided, inject them before navigating
    if (options.cookies && options.cookies.trim()) {
      onLog("Injecting session cookies into Google domain...");
      const parsed = parseCookies(options.cookies);
      await context.addCookies(parsed);
    }

    onLog("Navigating to https://gemini.google.com/app...");
    await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });

    // Handle initial loading and verify if logged in
    onLog("Checking login status...");
    
    // If there is an 'Sign in' button or element, it means we are not logged in or cookies are stale
    const signInVisible = await page.locator("text=Sign in").isVisible().catch(() => false);
    const dangNhapVisible = await page.locator("text=Đăng nhập").isVisible().catch(() => false);
    
    if (signInVisible || dangNhapVisible) {
      throw new Error("Authentication failed: Stale or invalid cookies. 'Sign in' button detected.");
    }

    // Wait for the prompt input box to load
    onLog("Waiting for Gemini prompt textarea to render...");
    const inputSelector = 'div[contenteditable="true"], div[role="textbox"], textarea';
    await page.waitForSelector(inputSelector, { timeout: 30000 });

    // Try to find and enable "3.1 Pro" model and "Deep Think" mode if requested
    const shouldEnableDeepThink = options.enableDeepThink !== false;
    if (shouldEnableDeepThink) {
      onLog("Đang tự động chọn Model '3.1 Pro' và kích hoạt 'Deep Think'...");
    } else {
      onLog("Đang tự động chọn Model '3.1 Pro' (chế độ đơn thuần)...");
    }

    try {
      // Hàm mở Menu chọn Model
      const openMenu = async () => {
        onLog("Mở Menu chọn Model...");
        const menuBtn = page.locator('button[aria-haspopup="menu"], button[aria-haspopup="listbox"], div[role="button"], button').filter({ hasText: /Pro|Flash|Model|Gemini/i }).first();
        await menuBtn.click();
        await page.waitForTimeout(1000);
      };

      // Bước 1: Click mở Menu chọn Model
      await openMenu();

      // Bước 2: Click chọn "3.1 Pro"
      onLog("Click chọn '3.1 Pro'...");
      const proOption = page.getByText("3.1 Pro").first();
      if (await proOption.isVisible().catch(() => false)) {
        await proOption.click();
      } else {
        await page.locator('text="3.1 Pro"').first().click();
      }
      await page.waitForTimeout(1500);

      if (shouldEnableDeepThink) {
        // Bước 3: Click mở LẠI Menu chọn Model
        onLog("Click mở LẠI Menu chọn Model...");
        await openMenu();

        // Bước 4: Click chọn "Deep Think"
        onLog("Click chọn 'Deep Think'...");
        const deepThinkOption = page.getByText("Deep Think").first();
        const tuDuySauOption = page.getByText("Tư duy sâu").first();

        if (await deepThinkOption.isVisible().catch(() => false)) {
          await deepThinkOption.click();
        } else if (await tuDuySauOption.isVisible().catch(() => false)) {
          await tuDuySauOption.click();
        } else {
          await page.locator('text=/Deep Think|Tư duy sâu/i').first().click();
        }
        await page.waitForTimeout(1000);

        // Đóng menu an toàn nếu còn hiển thị
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(500);

        onLog("Đã chọn Model '3.1 Pro' và kích hoạt 'Deep Think' thành công!");
      } else {
        // Đóng menu an toàn nếu còn hiển thị
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(500);

        onLog("Đã chọn Model '3.1 Pro' (đơn thuần) thành công!");
      }
    } catch (modelErr: any) {
      onLog("⚠️ [Cảnh báo] Không thể tự động chọn Model/Deep Think. Đang sử dụng Model mặc định! Chi tiết: " + (modelErr.message || modelErr));
    }

    // Inject prompt directly into the DOM to avoid crash / typing slowness
    onLog(`Injecting prompt into input field (Prompt length: ${prompt.length} chars)...`);
    const inputElement = page.locator(inputSelector).first();
    
    await inputElement.evaluate((el: any, text: string) => {
      // Focus on the element
      el.focus();
      
      // Inject text
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = text;
      } else {
        el.innerText = text;
      }
      
      // Dispatch necessary input events so Google React/Angular knows we typed something
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }, prompt);

    await page.waitForTimeout(1000);

    // Locate the "Send" button and click it
    onLog("Locating send button...");
    const sendButtonSelector = 'button[aria-label*="Send message" i], button[aria-label*="Gửi" i], button[aria-label*="Submit" i], button:has(mat-icon:has-text("send")), button.send-button';
    const sendButton = page.locator(sendButtonSelector).first();
    
    if (await sendButton.isVisible() && await sendButton.isEnabled()) {
      onLog("Clicking send button to dispatch prompt...");
      await sendButton.click();
    } else {
      onLog("Send button is not clickable or disabled. Attempting to press Enter as fallback...");
      await inputElement.focus();
      await page.keyboard.press("Enter");
    }

    onLog("Prompt sent successfully! Waiting for Gemini Deep Think response...");
    
    // Wait for the stop generating button to appear first (optional/brief wait)
    await page.waitForTimeout(3000);

    // Implement a polling loop to wait for response completion
    const startTime = Date.now();
    let isGenerating = true;
    
    // Standard elements representing stop button
    const stopButtonSelector = 'button[aria-label*="Stop" i], button[aria-label*="Dừng" i], button.stop-button';
    // Copy buttons representing completed generation
    const copyButtonSelector = 'button[aria-label*="Copy" i], button[aria-label*="Sao chép" i], mat-icon[svgicon*="copy"], .copy-button';

    while (isGenerating) {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        onLog("Warning: Translation operation timed out at 5 minutes. Scraping partial response...");
        break;
      }

      // Check if Stop button is visible
      const stopVisible = await page.locator(stopButtonSelector).isVisible().catch(() => false);
      
      // Check if Copy button is visible under the last message content
      const copyVisible = await page.locator(copyButtonSelector).last().isVisible().catch(() => false);
      
      if (stopVisible) {
        // Still generating
        if (elapsed % 15000 < 1000) {
          onLog(`Gemini is still thinking and generating response... Elapsed: ${Math.round(elapsed / 1000)}s`);
        }
        await page.waitForTimeout(2000);
      } else {
        // If stop button is NOT visible, verify if Copy button is visible OR send button is enabled
        const sendVisible = await sendButton.isVisible().catch(() => false);
        const sendEnabled = await sendButton.isEnabled().catch(() => false);
        
        if (copyVisible) {
          onLog("Generation finished: Copy button detected.");
          isGenerating = false;
        } else if (sendVisible && sendEnabled) {
          onLog("Generation finished: Send button is enabled again.");
          isGenerating = false;
        } else {
          // Double check if any text is loaded
          await page.waitForTimeout(2000);
          const stopVisibleAgain = await page.locator(stopButtonSelector).isVisible().catch(() => false);
          const copyVisibleAgain = await page.locator(copyButtonSelector).last().isVisible().catch(() => false);
          
          if (!stopVisibleAgain) {
            onLog("No stop button and no pending states. Assuming complete.");
            isGenerating = false;
          } else if (copyVisibleAgain) {
            onLog("Copy button detected on second check. Complete.");
            isGenerating = false;
          }
        }
      }
    }

    onLog("Extracting generated text from response message bubbles...");
    
    // Selectors for message contents
    const messageContentSelector = 'message-content, .message-content, .markdown, div[data-message-id] message-content';
    const bubbles = page.locator(messageContentSelector);
    const count = await bubbles.count();
    
    if (count === 0) {
      throw new Error("Failed to locate any generated message bubbles on the page.");
    }

    // Get the very last bubble (which is the model's response)
    onLog(`Found ${count} message bubbles. Extracting text from last bubble...`);
    const lastBubble = bubbles.nth(count - 1);
    
    const resultText = await lastBubble.evaluate((el: any) => el.innerText);
    
    if (!resultText || !resultText.trim()) {
      throw new Error("Scraped response is empty.");
    }

    onLog(`Extraction complete! Received ${resultText.length} characters.`);
    return resultText.trim();

  } catch (error: any) {
    onLog(`Error during Playwright Gemini automation: ${error.message || error}`);
    throw error;
  } finally {
    if (context) {
      onLog("Closing browser context...");
      await context.close().catch(() => {});
    }
  }
}

/**
 * Validates a Gemini __Secure-1PSID cookie status via Playwright with Proxy support
 */
export async function checkCookieLivePlaywright(
  cookieStr: string,
  proxy?: string,
  onLog?: (msg: string) => void
): Promise<{ status: 'live' | 'dead'; error?: string }> {
  let context: BrowserContext | null = null;
  const logger = onLog || console.log;

  logger("Khởi động Playwright để kiểm tra cookie...");
  try {
    const launchOptions: any = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--use-fake-ui-for-media-stream",
        "--disable-infobars"
      ]
    };

    if (proxy && proxy.trim()) {
      logger(`Sử dụng proxy khi kiểm tra cookie: ${proxy.trim()}`);
      launchOptions.proxy = { server: proxy.trim() };
    }

    const browser = await chromium.launch(launchOptions);
    context = await browser.newContext();

    await context.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9,vi;q=0.8"
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    logger("Nạp Cookie __Secure-1PSID vào trình duyệt...");
    const parsed = parseCookies(cookieStr);
    await context.addCookies(parsed);

    logger("Đang điều hướng đến https://gemini.google.com/app để đối chiếu...");
    await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });

    // Kiểm tra đăng nhập
    const signInVisible = await page.locator("text=Sign in").isVisible().catch(() => false);
    const dangNhapVisible = await page.locator("text=Đăng nhập").isVisible().catch(() => false);

    if (signInVisible || dangNhapVisible) {
      logger("Phát hiện nút Sign In/Đăng nhập. Cookie hết hạn hoặc không hợp lệ.");
      return { status: 'dead', error: 'Cookie không hợp lệ hoặc hết hạn.' };
    }

    // Kiểm tra sự xuất hiện của ô nhập liệu
    const inputSelector = 'div[contenteditable="true"], div[role="textbox"], textarea';
    const inputField = page.locator(inputSelector).first();
    const isInputVisible = await inputField.isVisible().catch(() => false);

    if (!isInputVisible) {
      await page.waitForSelector(inputSelector, { timeout: 10000 }).catch(() => {});
      const isInputVisibleAgain = await inputField.isVisible().catch(() => false);
      if (!isInputVisibleAgain) {
        logger("Không tìm thấy ô nhập liệu của Gemini. Có thể trang load lỗi.");
        return { status: 'dead', error: 'Không tìm thấy giao diện trò chuyện của Gemini.' };
      }
    }

    logger("Đăng nhập thành công! Cookie LIVE.");
    return { status: 'live' };
  } catch (error: any) {
    logger(`Lỗi trong quá trình kiểm tra cookie Playwright: ${error.message || error}`);
    return { status: 'dead', error: `Không thể kiểm tra hoặc kết nối lỗi: ${error.message || error}` };
  } finally {
    if (context) {
      logger("Đóng trình duyệt kiểm tra...");
      await context.close().catch(() => {});
    }
  }
}
