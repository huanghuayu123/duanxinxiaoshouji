import phoneCss from '../tavern-phone-assistant/styles.css?raw';

// ────────────────────────────── Types ──────────────────────────────

interface PhoneMessage {
  id: string;
  role: 'user' | 'char' | 'system';
  content: string;
  ts: number;
}

interface PhoneSettings {
  tavernToPhone: boolean;
  phoneToTavern: boolean;
  autoTrigger: boolean;
  /** 联系人名称（对应酒馆角色名） */
  contactName: string;
  /** AI 正文里包裹手机消息的标签名 */
  outTag: string;
}

// ────────────────────────────── Constants ──────────────────────────

const MSG_KEY = 'pa_phone_messages';
const SET_KEY = 'pa_phone_settings';
const SEEN_KEY = 'pa_phone_seen_segments';
const POS_KEY = 'pa_phone_positions';
const MAX_MSGS = 100;
const DEFAULT_SMS_TAG = '短信';

const DEFAULT_SETTINGS: PhoneSettings = {
  tavernToPhone: true,
  phoneToTavern: true,
  autoTrigger: true,
  contactName: '',
  outTag: DEFAULT_SMS_TAG,
};

// ────────────────────────────── Utilities ──────────────────────────

function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — silently ignore
  }
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function timeStr(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function getViewportSize(doc: Document): { width: number; height: number } {
  const win = doc.defaultView ?? window;
  return {
    width: win.visualViewport?.width ?? win.innerWidth ?? doc.documentElement.clientWidth,
    height: win.visualViewport?.height ?? win.innerHeight ?? doc.documentElement.clientHeight,
  };
}

function getPositions(): Record<string, { left: number; top: number }> {
  return storageGet<Record<string, { left: number; top: number }>>(POS_KEY, {});
}

function savePosition(key: string, el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const positions = getPositions();
  positions[key] = { left: Math.round(rect.left), top: Math.round(rect.top) };
  storageSet(POS_KEY, positions);
}

function placeElement(el: HTMLElement, left: number, top: number): void {
  const doc = getUiDocument();
  const view = getViewportSize(doc);
  const rect = el.getBoundingClientRect();
  const safeLeft = clamp(left, 8, Math.max(8, view.width - rect.width - 8));
  const safeTop = clamp(top, 8, Math.max(8, view.height - rect.height - 8));

  el.style.left = `${safeLeft}px`;
  el.style.top = `${safeTop}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function restorePosition(key: string, el: HTMLElement): void {
  const pos = getPositions()[key];
  if (!pos) return;
  requestAnimationFrame(() => placeElement(el, pos.left, pos.top));
}

/** Access the tavern parent window safely */
function getParent(): Window | null {
  try {
    return window.parent !== window ? window.parent : window;
  } catch {
    return null;
  }
}

/** Get SillyTavern global from parent */
function getSillyTavern(): Record<string, unknown> | null {
  try {
    const p = getParent();
    if (p && 'SillyTavern' in p) {
      return (p as unknown as Record<string, unknown>).SillyTavern as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Access parent event system */
function getEventSource(): Record<string, unknown> | null {
  try {
    const p = getParent();
    if (p && 'eventSource' in p) {
      return (p as unknown as Record<string, unknown>).eventSource as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Access parent toastr */
function getToastr(): Record<string, unknown> | null {
  try {
    const p = getParent();
    if (p && 'toastr' in p) {
      return (p as unknown as Record<string, unknown>).toastr as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parentToast(msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const t = getToastr();
  if (t && typeof t[type] === 'function') {
    (t[type] as (msg: string) => void)(msg);
  }
}

// ────────────────────────────── Settings ───────────────────────────

function loadSettings(): PhoneSettings {
  const saved = storageGet<Partial<PhoneSettings>>(SET_KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

function saveSettings(s: PhoneSettings): void {
  storageSet(SET_KEY, s);
}

// ────────────────────────────── Message Store ──────────────────────

function loadMessages(): PhoneMessage[] {
  return storageGet<PhoneMessage[]>(MSG_KEY, []);
}

function saveMessages(msgs: PhoneMessage[]): void {
  while (msgs.length > MAX_MSGS) {
    msgs.shift();
  }
  storageSet(MSG_KEY, msgs);
}

function addMessage(role: PhoneMessage['role'], content: string): PhoneMessage {
  const msgs = loadMessages();
  const msg: PhoneMessage = { id: uid(), role, content, ts: Date.now() };
  msgs.push(msg);
  saveMessages(msgs);
  return msg;
}

function clearMessages(): void {
  localStorage.removeItem(MSG_KEY);
  localStorage.removeItem(SEEN_KEY);
}

function loadSeenSegments(): Set<string> {
  return new Set(storageGet<string[]>(SEEN_KEY, []));
}

function saveSeenSegments(seen: Set<string>): void {
  const list = Array.from(seen).slice(-500);
  storageSet(SEEN_KEY, list);
}

// ────────────────────────────── SillyTavern Integration ────────────

function getCharName(): string {
  const st = getSillyTavern();
  if (st && typeof st.name2 === 'string' && st.name2) {
    return st.name2;
  }
  // fallback to settings
  const settings = loadSettings();
  return settings.contactName || '角色';
}

function getUserName(): string {
  const st = getSillyTavern();
  if (st && typeof st.name1 === 'string' && st.name1) {
    return st.name1;
  }
  return '用户';
}

/** Extract content wrapped in <tag>...</tag> */
function extractTagContent(text: string, tag: string): string[] {
  const results: string[] = [];
  const safeTag = escapeRegExp(tag.trim() || DEFAULT_SMS_TAG);
  let match: RegExpExecArray | null;
  const re = new RegExp(`<${safeTag}>([\\s\\S]*?)<\\/${safeTag}>`, 'gi');
  while ((match = re.exec(text)) !== null) {
    if (match[1].trim()) {
      results.push(match[1].trim());
    }
  }
  return results;
}

/** Send text to SillyTavern chat input */
function findTavernInput(doc: Document): HTMLElement | null {
  const selectors = [
    '#send_textarea',
    'textarea#send_textarea',
    'textarea.send_text',
    '#send_form textarea',
    '.send_form textarea',
    '#send_form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el && !el.closest('#pa-script-root')) return el;
  }

  return null;
}

function dispatchInputEvent(el: HTMLElement, win: Window, text: string): void {
  try {
    el.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  } catch {
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  el.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
}

function setTavernInputText(el: HTMLElement, text: string, win: Window): void {
  if (el instanceof win.HTMLTextAreaElement || el instanceof win.HTMLInputElement) {
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (valueSetter) {
      valueSetter.call(el, text);
    } else {
      el.value = text;
    }
  } else if (el.isContentEditable) {
    el.textContent = text;
  }

  dispatchInputEvent(el, win, text);
}

function getTavernInputText(el: HTMLElement, win: Window): string {
  if (el instanceof win.HTMLTextAreaElement || el instanceof win.HTMLInputElement) return el.value;
  return el.textContent ?? '';
}

function findTavernSendButton(doc: Document): HTMLElement | null {
  const selectors = [
    '#send_but',
    '#send_form #send_but',
    '.send_button',
    '.mes_btn_send',
    'button[title="Send"]',
    'button[aria-label="Send"]',
    '#send_form button[type="button"]',
    '#send_form button',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el && !el.closest('#pa-script-root')) return el;
  }

  return null;
}

function activateTavernSendButton(sendBtn: HTMLElement, win: Window): void {
  sendBtn.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: win }));
  sendBtn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
  sendBtn.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
  sendBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
  sendBtn.click?.();
}

/** Send text to SillyTavern chat input */
function sendToTavernInput(text: string): boolean {
  try {
    const parent = getParent();
    if (!parent) {
      parentToast('Cannot access tavern page', 'error');
      return false;
    }

    const doc = parent.document;
    const win = doc.defaultView ?? parent;
    const input = findTavernInput(doc);
    if (!input) {
      parentToast('Cannot find tavern input box', 'warning');
      return false;
    }

    setTavernInputText(input, text, win);

    const jq = (parent as unknown as { $?: unknown }).$;
    if (typeof jq === 'function') {
      const $ = jq as (el: Element) => { val?: (value: string) => unknown; trigger: (event: string) => unknown };
      const wrapped = $(input);
      wrapped.val?.(text);
      wrapped.trigger('input');
      wrapped.trigger('change');
      wrapped.trigger('keyup');
    }

    input.focus();

    const sendBtn = findTavernSendButton(doc);
    if (!sendBtn) {
      parentToast('Message filled into tavern input, send button not found', 'info');
      return false;
    }

    if (typeof jq === 'function') {
      const wrappedSend = (jq as (el: Element) => { trigger: (event: string) => unknown })(sendBtn);
      wrappedSend.trigger('mousedown');
      wrappedSend.trigger('mouseup');
      wrappedSend.trigger('click');
    } else {
      activateTavernSendButton(sendBtn, win);
    }
    activateTavernSendButton(sendBtn, win);

    setTimeout(() => {
      if (getTavernInputText(input, win).trim() === text.trim()) {
        input.dispatchEvent(new win.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
          code: 'Enter',
        }));
        sendToTavernAPI(text);
      }
    }, 80);

    parentToast('Sent through tavern input', 'success');
    return true;
  } catch (err) {
    parentToast(`Send failed: ${String(err)}`, 'error');
    return false;
  }
}
/** Directly call tavern's sendMessage API if available */
function sendToTavernAPI(text: string): boolean {
  try {
    const parent = getParent();
    if (!parent) return false;

    // Try parent scope's sendMessage function
    const win = parent as unknown as Record<string, unknown>;
    if (typeof win.sendMessage === 'function') {
      (win.sendMessage as (msg: string) => unknown)(text);
      return true;
    }
    // Try via SillyTavern context
    const st = win.SillyTavern as Record<string, unknown> | undefined;
    if (st && typeof st.getContext === 'function') {
      const ctx = (st.getContext as () => Record<string, unknown>)();
      const send = ctx.sendMessage as ((msg: string) => unknown) | undefined;
      if (typeof send === 'function') {
        send(text);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Send phone message to tavern */
function phoneToTavernBridge(content: string): void {
  const settings = loadSettings();
  if (!settings.phoneToTavern) return;

  const sent = sendToTavernInput(content);

  if (!sent && settings.autoTrigger) {
    try {
      const parent = getParent();
      if (parent) {
        const win = parent as unknown as Record<string, unknown>;
        // Try to trigger generation
        if (typeof win.generateMessage === 'function') {
          setTimeout(() => (win.generateMessage as () => void)(), 300);
        } else if (typeof win.sendMessageAndGenerate === 'function') {
          setTimeout(() => (win.sendMessageAndGenerate as () => void)(), 300);
        }
      }
    } catch {
      // ignore
    }
  }
}

// ────────────────────────────── Event Listeners on Tavern ──────────

let eventCleanups: Array<() => void> = [];
let quickReplyTimer: number | undefined;
let uiDocument: Document = document;

function getUiDocument(): Document {
  return uiDocument;
}

function getHostDocument(): Document {
  try {
    return getParent()?.document ?? document;
  } catch {
    return document;
  }
}

function injectPhoneStyle(doc: Document): void {
  if (doc.getElementById('pa-phone-style')) return;

  const style = doc.createElement('style');
  style.id = 'pa-phone-style';
  style.textContent = phoneCss;
  doc.head?.appendChild(style);
}

function setupTavernListeners(): void {
  // Cleanup previous
  eventCleanups.forEach(fn => fn());
  eventCleanups = [];

  const es = getEventSource();
  if (!es || typeof es.on !== 'function') {
    console.info('[PA] eventSource not available, retrying in 2s...');
    setTimeout(setupTavernListeners, 2000);
    return;
  }

  const evOn = es.on as (event: string, cb: (...args: unknown[]) => void) => unknown;

  // Listen for new messages
  const unsub1 = tryListenEvent(evOn, 'MESSAGE_RECEIVED', (_msgId?: unknown) => {
    handleTavernMessages();
  });
  if (unsub1) eventCleanups.push(unsub1);

  // Listen for generation complete
  const unsub2 = tryListenEvent(evOn, 'GENERATION_AFTER_COMMANDS', (_msgId?: unknown) => {
    handleTavernMessages();
  });
  if (unsub2) eventCleanups.push(unsub2);

  // Listen for chat changes
  const unsub3 = tryListenEvent(evOn, 'CHAT_CHANGED', () => {
    handleTavernMessages();
    console.info('[PA] chat changed');
  });
  if (unsub3) eventCleanups.push(unsub3);

  console.info('[PA] tavern listeners established');
}

function tryListenEvent(
  evOn: (event: string, cb: (...args: unknown[]) => void) => unknown,
  event: string,
  cb: (...args: unknown[]) => void,
): (() => void) | null {
  try {
    const result = evOn(event, cb);
    // Some event systems return a stop/unsubscribe function
    if (result && typeof (result as { stop?: () => void }).stop === 'function') {
      return (result as { stop: () => void }).stop;
    }
    return () => {
      try {
        const es = getEventSource();
        if (es && typeof es.removeListener === 'function') {
          (es.removeListener as (e: string, c: (...args: unknown[]) => void) => void)(event, cb);
        }
        if (es && typeof es.off === 'function') {
          (es.off as (e: string, c: (...args: unknown[]) => void) => void)(event, cb);
        }
      } catch {
        // ignore during cleanup
      }
    };
  } catch {
    return null;
  }
}

function readTavernMessages(): Array<{ messageId: string; content: string }> {
  try {
    if (typeof getLastMessageId === 'function' && typeof getChatMessages === 'function') {
      const lastId = getLastMessageId();
      if (lastId >= 0) {
        return getChatMessages(`0-${lastId}`, {
          role: 'all',
          hide_state: 'all',
          include_swipes: false,
        })
          .filter((message) => typeof message.message === 'string' && message.message.trim())
          .map((message) => ({
            messageId: String(message.message_id),
            content: message.message,
          }));
      }
    }
  } catch (err) {
    console.warn('[PA] getChatMessages unavailable, falling back to SillyTavern.chat:', err);
  }

  const st = getSillyTavern();
  const chat = (st as Record<string, unknown> | null)?.chat as
    | Array<{ mes?: unknown; mesid?: unknown }>
    | undefined;
  if (!chat) return [];

  return chat
    .map((message, index) => ({
      messageId: String(message.mesid ?? index),
      content: typeof message.mes === 'string' ? message.mes : '',
    }))
    .filter((message) => message.content.trim());
}

function handleTavernMessages(): void {
  const settings = loadSettings();
  if (!settings.tavernToPhone) return;

  try {
    const seen = loadSeenSegments();
    let added = 0;

    for (const message of readTavernMessages()) {
      const extracted = extractTagContent(message.content, settings.outTag);
      extracted.forEach((text, index) => {
        const signature = `${message.messageId}:${index}:${simpleHash(text)}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        addMessage('char', text);
        added += 1;
      });
    }

    if (added === 0) return;

    saveSeenSegments(seen);
    renderMessages();
    parentToast(`收到 ${added} 条手机消息`, 'success');
  } catch (err) {
    console.warn('[PA] error processing tavern message:', err);
  }
}

function injectQuickReplyStyle(doc: Document): void {
  if (doc.getElementById('pa-quick-reply-style')) return;
  const style = doc.createElement('style');
  style.id = 'pa-quick-reply-style';
  style.textContent = `
    .pa-qr-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 4px 10px;
      margin: 2px;
      border: 1px solid rgba(120, 160, 255, 0.55);
      border-radius: 8px;
      background: rgba(20, 28, 42, 0.78);
      color: #eaf1ff;
      font-size: 13px;
      line-height: 1.2;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      vertical-align: middle;
    }
    .pa-qr-button:hover,
    .pa-qr-button.pa-qr-button--active {
      background: rgba(10, 132, 255, 0.92);
      border-color: rgba(180, 215, 255, 0.9);
      color: #fff;
    }
  `;
  doc.head?.appendChild(style);
}

function findQuickReplyHost(doc: Document): HTMLElement | null {
  const selectors = [
    '#quickReplyBar',
    '#quickReplyBarInner',
    '#qr--bar',
    '#qr--buttons',
    '#qr_buttons',
    '.quickReplyBar',
    '.quick-reply-bar',
    '.qr--buttons',
    '.qr_buttons',
    '.qr-button-container',
    '#send_form',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el) return el;
  }

  return null;
}

function updateQuickReplyButtonState(): void {
  const parent = getParent();
  const doc = parent?.document;
  const button = doc?.getElementById('pa-qr-phone-button');
  button?.classList.toggle('pa-qr-button--active', panelVisible);
  if (button) button.setAttribute('aria-pressed', String(panelVisible));
}

function ensureQuickReplyButton(): boolean {
  const parent = getParent();
  if (!parent) return false;

  const doc = parent.document;
  injectQuickReplyStyle(doc);

  let button = doc.getElementById('pa-qr-phone-button') as HTMLButtonElement | null;
  if (button) {
    updateQuickReplyButtonState();
    return true;
  }

  const host = findQuickReplyHost(doc);
  if (!host) return false;

  button = doc.createElement('button');
  button.id = 'pa-qr-phone-button';
  button.type = 'button';
  button.className = 'pa-qr-button';
  button.textContent = '手机';
  button.title = '打开/关闭手机消息';
  button.setAttribute('aria-label', '打开或关闭手机消息面板');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (wasRecentTouchTap(button)) return;
    togglePanel();
  });
  bindTouchFallback(button, () => togglePanel());

  host.appendChild(button);
  updateQuickReplyButtonState();
  return true;
}

function setupQuickReplyButton(): void {
  if (ensureQuickReplyButton()) return;
  quickReplyTimer = window.setInterval(() => {
    if (ensureQuickReplyButton() && quickReplyTimer !== undefined) {
      window.clearInterval(quickReplyTimer);
      quickReplyTimer = undefined;
    }
  }, 1500);
}

// ────────────────────────────── Phone UI ──────────────────────────

// State
let panelVisible = false;
let settingsVisible = false;

function createUI(parentId: string): void {
  const doc = getUiDocument();
  const container = doc.getElementById(parentId);
  if (!container) return;

  // FAB
  const fab = doc.createElement('div');
  fab.id = 'pa-fab';
  fab.className = 'pa-fab';
  fab.innerHTML = `<svg class="pa-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
    <line x1="12" y1="18" x2="12" y2="18" stroke-width="3"/>
  </svg>`;
  fab.title = '打开手机面板';
  container.appendChild(fab);
  restorePosition('fab', fab);

  // Panel
  const panel = doc.createElement('div');
  panel.id = 'pa-panel';
  panel.className = 'pa-panel pa-panel--hidden';

  panel.innerHTML = `
    <div class="pa-statusbar">
      <span id="pa-title" class="pa-statusbar__title">手机消息</span>
      <span id="pa-badge" class="pa-statusbar__badge" style="display:none">0</span>
      <button id="pa-settings-btn" class="pa-statusbar__btn" title="设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button id="pa-close-btn" class="pa-statusbar__btn" title="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div id="pa-messages" class="pa-messages">
      <div class="pa-messages__empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
        </svg>
        <span>暂无消息</span>
        <span style="font-size:11px">AI 输出 &lt;短信&gt; 内容时自动接收</span>
      </div>
    </div>
    <div class="pa-input">
      <textarea id="pa-input-field" class="pa-input__field" placeholder="输入手机消息..." rows="1"></textarea>
      <button id="pa-input-send" class="pa-input__send" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <!-- Settings Overlay -->
    <div id="pa-settings" class="pa-settings pa-settings--hidden">
      <div class="pa-settings__header">
        <button id="pa-settings-back" class="pa-statusbar__btn" title="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span class="pa-settings__title">联动设置</span>
      </div>
      <div class="pa-settings__body">
        <div class="pa-setting-row">
          <div>
            <div class="pa-setting-row__label">酒馆 → 手机</div>
            <div class="pa-setting-row__desc">AI 输出 &lt;短信&gt; 标签时自动添加为手机消息</div>
          </div>
          <div id="pa-toggle-tp" class="pa-toggle"></div>
        </div>
        <div class="pa-setting-row">
          <div>
            <div class="pa-setting-row__label">手机 → 酒馆</div>
            <div class="pa-setting-row__desc">手机输入的消息自动发送到酒馆对话框</div>
          </div>
          <div id="pa-toggle-pt" class="pa-toggle"></div>
        </div>
        <div class="pa-setting-row">
          <div>
            <div class="pa-setting-row__label">自动触发 AI 回复</div>
            <div class="pa-setting-row__desc">发送消息后自动触发 AI 生成回复</div>
          </div>
          <div id="pa-toggle-at" class="pa-toggle"></div>
        </div>
        <div>
          <label class="pa-setting-row__label">输出标签</label>
          <div class="pa-setting-row__desc" style="margin-bottom:6px">AI 输出中用此标签包裹的内容会被解析为手机消息</div>
          <input id="pa-tag-input" class="pa-settings-input" type="text" value="${DEFAULT_SMS_TAG}" />
        </div>
        <div>
          <label class="pa-setting-row__label">联系人名称（可选）</label>
          <div class="pa-setting-row__desc" style="margin-bottom:6px">留空则自动使用酒馆当前角色名</div>
          <input id="pa-contact-input" class="pa-settings-input" type="text" placeholder="留空自动" />
        </div>
        <button id="pa-clear-btn" class="pa-settings-btn pa-settings-btn--danger">清除所有手机消息</button>
        <div class="pa-settings__info">
          提示：AI 输出包含 <code>&lt;短信&gt;内容&lt;/短信&gt;</code> 时，内容会自动出现在手机面板中。
          在手机面板输入的消息会发送到酒馆对话框。
        </div>
      </div>
    </div>
  `;

  container.appendChild(panel);
  restorePosition('panel', panel);
}

// ────────────────────────────── UI Logic ──────────────────────────

function togglePanel(show?: boolean): void {
  const panel = getUiDocument().getElementById('pa-panel');
  const fab = getUiDocument().getElementById('pa-fab');
  if (!panel || !fab) return;

  panelVisible = show !== undefined ? show : !panelVisible;

  panel.classList.toggle('pa-panel--hidden', !panelVisible);
  fab.classList.toggle('pa-fab--hidden', panelVisible);
  updateQuickReplyButtonState();

  if (panelVisible) {
    const panelEl = panel as HTMLElement;
    const rect = panelEl.getBoundingClientRect();
    placeElement(panelEl, rect.left, rect.top);
    renderMessages();
    // Scroll to bottom
    const msgsEl = getUiDocument().getElementById('pa-messages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
}

function renderMessages(): void {
  const doc = getUiDocument();
  const msgsEl = getUiDocument().getElementById('pa-messages');
  if (!msgsEl) return;

  const msgs = loadMessages();
  const emptyEl = msgsEl.querySelector('.pa-messages__empty');

  if (msgs.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    // Remove any message elements
    msgsEl.querySelectorAll('.pa-msg').forEach(el => el.remove());
    updateBadge(0);
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  updateBadge(msgs.filter(m => m.role === 'char').length);

  // Build message elements
  const existingIds = new Set<string>();
  msgsEl.querySelectorAll('.pa-msg').forEach(el => {
    const id = el.getAttribute('data-id');
    if (id) existingIds.add(id);
  });

  // Remove messages that no longer exist
  const currentIds = new Set(msgs.map(m => m.id));
  msgsEl.querySelectorAll('.pa-msg').forEach(el => {
    const id = el.getAttribute('data-id');
    if (id && !currentIds.has(id)) el.remove();
  });

  // Add or update messages
  for (const msg of msgs) {
    if (existingIds.has(msg.id)) continue;

    const div = doc.createElement('div');
    div.className = `pa-msg pa-msg--${msg.role}`;
    div.setAttribute('data-id', msg.id);

    const bubble = doc.createElement('div');
    bubble.className = 'pa-msg__bubble';
    bubble.textContent = msg.content;

    const time = doc.createElement('div');
    time.className = 'pa-msg__time';
    time.textContent = timeStr(msg.ts);

    div.appendChild(bubble);
    div.appendChild(time);
    msgsEl.appendChild(div);
  }

  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function updateBadge(count: number): void {
  const badge = getUiDocument().getElementById('pa-badge');
  if (!badge) return;
  if (count > 0) {
    badge.style.display = '';
    badge.textContent = String(count);
  } else {
    badge.style.display = 'none';
  }
}

function toggleSettings(show?: boolean): void {
  const settingsEl = getUiDocument().getElementById('pa-settings');
  if (!settingsEl) return;
  settingsVisible = show !== undefined ? show : !settingsVisible;
  settingsEl.classList.toggle('pa-settings--hidden', !settingsVisible);
}

function renderSettings(): void {
  const s = loadSettings();
  setToggle('pa-toggle-tp', s.tavernToPhone);
  setToggle('pa-toggle-pt', s.phoneToTavern);
  setToggle('pa-toggle-at', s.autoTrigger);

  const tagInput = getUiDocument().getElementById('pa-tag-input') as HTMLInputElement;
  if (tagInput) tagInput.value = s.outTag;

  const contactInput = getUiDocument().getElementById('pa-contact-input') as HTMLInputElement;
  if (contactInput) contactInput.value = s.contactName;

  // Update status bar title
  const title = getUiDocument().getElementById('pa-title');
  if (title) {
    const charName = getCharName();
    const userName = getUserName();
    title.textContent = `${userName} · ${charName}`;
  }
}

function setToggle(id: string, on: boolean): void {
  const el = getUiDocument().getElementById(id);
  if (!el) return;
  el.classList.toggle('pa-toggle--on', on);

  // Ensure knob exists
  if (!el.querySelector('.pa-toggle__knob')) {
    const knob = getUiDocument().createElement('div');
    knob.className = 'pa-toggle__knob';
    el.appendChild(knob);
  }
}

// ────────────────────────────── Event Binding ──────────────────────

function setupDraggable(el: HTMLElement, handle: HTMLElement, storageKey: string): void {
  const doc = getUiDocument();
  let moved = false;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a')) return;

    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    moved = false;

    el.classList.add('pa-dragging');
    handle.setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      placeElement(el, startLeft + dx, startTop + dy);
    };

    const onUp = (upEvent: PointerEvent) => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
      handle.releasePointerCapture?.(upEvent.pointerId);
      el.classList.remove('pa-dragging');

      if (moved) {
        savePosition(storageKey, el);
      } else if (el.id === 'pa-fab') {
        togglePanel(true);
      }
    };

    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  });
}

function bindTouchFallback(el: HTMLElement, action: () => void): void {
  let touchMoved = false;
  let startX = 0;
  let startY = 0;

  el.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchMoved = false;
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  el.addEventListener('touchmove', (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - startX) + Math.abs(touch.clientY - startY) > 8) {
      touchMoved = true;
    }
  }, { passive: true });

  el.addEventListener('touchend', (event) => {
    if (touchMoved) return;
    el.dataset.paLastTouchTap = String(Date.now());
    action();
  }, { passive: true });
}

function wasRecentTouchTap(el: HTMLElement): boolean {
  const last = Number(el.dataset.paLastTouchTap || 0);
  return Number.isFinite(last) && Date.now() - last < 450;
}

function bindEvents(): void {
  // FAB click - open panel
  const fab = getUiDocument().getElementById('pa-fab') as HTMLElement | null;
  const panel = getUiDocument().getElementById('pa-panel') as HTMLElement | null;
  const statusbar = getUiDocument().querySelector('#pa-panel .pa-statusbar') as HTMLElement | null;

  if (fab) {
    setupDraggable(fab, fab, 'fab');
    fab.addEventListener('click', () => togglePanel(true));
    bindTouchFallback(fab, () => togglePanel(true));
  }

  if (panel && statusbar) {
    setupDraggable(panel, statusbar, 'panel');
  }

  // Close panel
  getUiDocument().getElementById('pa-close-btn')?.addEventListener('click', () => togglePanel(false));

  // Settings toggle
  getUiDocument().getElementById('pa-settings-btn')?.addEventListener('click', () => {
    renderSettings();
    toggleSettings(true);
  });

  // Settings back
  getUiDocument().getElementById('pa-settings-back')?.addEventListener('click', () => {
    toggleSettings(false);
  });

  // Toggle: tavern→phone
  setupToggleClick('pa-toggle-tp', (on) => {
    const s = loadSettings();
    s.tavernToPhone = on;
    saveSettings(s);
  });

  // Toggle: phone→tavern
  setupToggleClick('pa-toggle-pt', (on) => {
    const s = loadSettings();
    s.phoneToTavern = on;
    saveSettings(s);
  });

  // Toggle: auto trigger
  setupToggleClick('pa-toggle-at', (on) => {
    const s = loadSettings();
    s.autoTrigger = on;
    saveSettings(s);
  });

  // Tag input
  const tagInput = getUiDocument().getElementById('pa-tag-input') as HTMLInputElement;
  tagInput?.addEventListener('change', () => {
    const s = loadSettings();
    s.outTag = tagInput.value.trim() || DEFAULT_SMS_TAG;
    saveSettings(s);
  });

  // Contact input
  const contactInput = getUiDocument().getElementById('pa-contact-input') as HTMLInputElement;
  contactInput?.addEventListener('change', () => {
    const s = loadSettings();
    s.contactName = contactInput.value.trim();
    saveSettings(s);
  });

  // Clear messages
  getUiDocument().getElementById('pa-clear-btn')?.addEventListener('click', () => {
    if (confirm('确定清除所有手机消息？')) {
      clearMessages();
      renderMessages();
      parentToast('手机消息已清除', 'info');
    }
  });

  // Send message
  const sendBtn = getUiDocument().getElementById('pa-input-send');
  const inputField = getUiDocument().getElementById('pa-input-field') as HTMLTextAreaElement;

  function doSend(): void {
    if (!inputField) return;
    const text = inputField.value.trim();
    if (!text) return;

    // Add user message to phone
    addMessage('user', text);
    renderMessages();
    inputField.value = '';
    inputField.style.height = 'auto';
    if (sendBtn) (sendBtn as HTMLButtonElement).disabled = true;

    // Bridge to tavern
    phoneToTavernBridge(text);
  }

  sendBtn?.addEventListener('click', doSend);

  inputField?.addEventListener('input', () => {
    // Auto-resize
    inputField.style.height = 'auto';
    inputField.style.height = Math.min(inputField.scrollHeight, 80) + 'px';
    if (sendBtn) {
      (sendBtn as HTMLButtonElement).disabled = !inputField.value.trim();
    }
  });

  inputField?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // Message auto-refresh when panel opens
  const observer = new MutationObserver(() => {
    const panel = getUiDocument().getElementById('pa-panel');
    if (panel && !panel.classList.contains('pa-panel--hidden')) {
      renderMessages();
    }
  });
  observer.observe(getUiDocument().body, { attributeFilter: ['class'], subtree: true });
}

function setupToggleClick(id: string, onChange: (on: boolean) => void): void {
  const el = getUiDocument().getElementById(id);
  if (!el) return;

  // Ensure knob exists
  if (!el.querySelector('.pa-toggle__knob')) {
    const knob = getUiDocument().createElement('div');
    knob.className = 'pa-toggle__knob';
    el.appendChild(knob);
  }

  el.addEventListener('click', () => {
    const currentlyOn = el.classList.contains('pa-toggle--on');
    el.classList.toggle('pa-toggle--on', !currentlyOn);
    onChange(!currentlyOn);
  });
}

// ────────────────────────────── Init ──────────────────────────────

function init(): void {
  const rootId = 'pa-script-root';
  uiDocument = getHostDocument();
  injectPhoneStyle(uiDocument);

  let root = uiDocument.getElementById(rootId);
  if (!root) {
    root = uiDocument.createElement('div');
    root.id = rootId;
    uiDocument.body.appendChild(root);
  }
  root.innerHTML = '';

  createUI(rootId);
  renderMessages();
  renderSettings();
  bindEvents();
  setupQuickReplyButton();

  // Setup tavern event listeners
  setupTavernListeners();
  handleTavernMessages();

  // Try to detect current character name and update
  const st = getSillyTavern();
  if (st) {
    if (typeof st.name2 === 'string') {
      const s = loadSettings();
      if (!s.contactName && st.name2) {
        s.contactName = st.name2;
        saveSettings(s);
      }
    }
  }

  window.addEventListener('pagehide', () => {
    eventCleanups.forEach(fn => fn());
    if (quickReplyTimer !== undefined) {
      window.clearInterval(quickReplyTimer);
    }
  });

  parentToast('手机助手已启动', 'info');
  console.info('[PA] tavern phone assistant initialized');
}

// Boot on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}






