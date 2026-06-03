import phoneCss from '../tavern-phone-assistant/styles.css?raw';

type PhoneRole = 'user' | 'char';

interface PhoneMessage {
  id: string;
  role: PhoneRole;
  text: string;
  time: number;
  source?: string;
}

interface PhoneState {
  messages: PhoneMessage[];
  seen: string[];
  readUntil?: number;
  positions: Record<string, { left: number; top: number }>;
}

interface ChatEntry {
  id: string;
  text: string;
  isUser: boolean;
}

interface ViewportInfo {
  width: number;
  height: number;
  layoutHeight: number;
  offsetTop: number;
  keyboardInset: number;
}

const ROOT_ID = 'xiaoxi-phone-root';
const STYLE_ID = 'xiaoxi-phone-style';
const STATE_KEY = 'xiaoxi_phone_state_v2';
const VERSION = 'v1.0.19';
const SMS_TAG = '短信';
const MAX_MESSAGES = 200;
const MAX_SEEN = 800;
const migratedKeys = new Set<string>();

let hostDocument: Document = document;
let panelOpen = false;
let cleanupFns: Array<() => void> = [];

function getParentWindow(): Window {
  try {
    return window.parent && window.parent !== window ? window.parent : window;
  } catch {
    return window;
  }
}

function getHostDocument(): Document {
  try {
    return getParentWindow().document ?? document;
  } catch {
    return document;
  }
}

function getTavernContext(): Record<string, unknown> | null {
  const win = getParentWindow() as unknown as Record<string, unknown>;
  const st = win.SillyTavern as { getContext?: unknown } | undefined;
  if (typeof st?.getContext === 'function') {
    try {
      return (st.getContext as () => Record<string, unknown>)();
    } catch {
      return null;
    }
  }
  return null;
}

function valueAsString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function readRecordValue(source: unknown, keys: string[]): string {
  if (!source || typeof source !== 'object') return '';
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = valueAsString(record[key]);
    if (value) return value;
  }
  return '';
}

function getCurrentCharacterKey(): string {
  const win = getParentWindow() as unknown as Record<string, unknown>;
  const context = getTavernContext();
  const st = win.SillyTavern as Record<string, unknown> | undefined;
  const id = readRecordValue(context, ['characterId', 'character_id', 'this_chid'])
    || readRecordValue(win, ['this_chid', 'characterId', 'character_id'])
    || readRecordValue(st, ['this_chid', 'characterId', 'character_id']);
  const characters = (context?.characters ?? win.characters ?? st?.characters) as unknown;
  const selected = Array.isArray(characters) && id !== '' ? characters[Number(id)] : null;
  const avatar = readRecordValue(selected, ['avatar', 'avatar_url', 'filename']);
  const name = readRecordValue(selected, ['name'])
    || readRecordValue(context, ['name2', 'characterName'])
    || readRecordValue(win, ['name2', 'characterName'])
    || readRecordValue(st, ['name2', 'characterName']);
  const source = [id, avatar, name].filter(Boolean).join('|') || 'global';
  return `${STATE_KEY}:${hashText(source)}`;
}

function getStorage(): Storage | null {
  try {
    return getParentWindow().localStorage ?? localStorage;
  } catch {
    try {
      return localStorage;
    } catch {
      return null;
    }
  }
}

function loadState(): PhoneState {
  const key = getCurrentCharacterKey();
  const storage = getStorage();
  try {
    let raw = storage?.getItem(key) ?? null;
    if (!raw && !migratedKeys.has(key)) {
      migratedKeys.add(key);
      raw = storage?.getItem(STATE_KEY) ?? null;
      if (raw) storage?.setItem(key, raw);
    }
    if (!raw) return { messages: [], seen: [], readUntil: 0, positions: {} };
    const parsed = JSON.parse(raw) as Partial<PhoneState>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      readUntil: typeof parsed.readUntil === 'number' ? parsed.readUntil : 0,
      positions: parsed.positions && typeof parsed.positions === 'object' ? parsed.positions : {},
    };
  } catch {
    return { messages: [], seen: [], readUntil: 0, positions: {} };
  }
}

function saveState(state: PhoneState): void {
  const key = getCurrentCharacterKey();
  const storage = getStorage();
  const next: PhoneState = {
    messages: state.messages.slice(-MAX_MESSAGES),
    seen: state.seen.slice(-MAX_SEEN),
    readUntil: state.readUntil ?? 0,
    positions: state.positions,
  };
  try {
    const raw = JSON.stringify(next);
    storage?.setItem(key, raw);
  } catch {
    // local storage may be unavailable in some embedded modes.
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function formatTime(time: number): string {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function viewport(): ViewportInfo {
  const win = hostDocument.defaultView ?? window;
  const layoutWidth = win.innerWidth ?? hostDocument.documentElement.clientWidth ?? 360;
  const layoutHeight = win.innerHeight ?? hostDocument.documentElement.clientHeight ?? 640;
  const visual = win.visualViewport;
  const width = visual?.width ?? layoutWidth;
  const height = visual?.height ?? layoutHeight;
  const offsetTop = visual?.offsetTop ?? 0;
  return {
    width,
    height,
    layoutHeight,
    offsetTop,
    keyboardInset: Math.max(0, layoutHeight - height - offsetTop),
  };
}

function setStyle(el: HTMLElement, name: string, value: string): void {
  el.style.setProperty(name, value, 'important');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function placeElement(el: HTMLElement, left: number, top: number): void {
  const view = viewport();
  const rect = el.getBoundingClientRect();
  const safeLeft = clamp(left, 8, Math.max(8, view.width - rect.width - 8));
  const safeTop = clamp(top, 8, Math.max(8, view.height - rect.height - 8));
  setStyle(el, 'left', `${Math.round(safeLeft)}px`);
  setStyle(el, 'top', `${Math.round(safeTop)}px`);
  setStyle(el, 'right', 'auto');
  setStyle(el, 'bottom', 'auto');
}

function rememberPosition(key: 'fab' | 'panel', el: HTMLElement): void {
  const state = loadState();
  const rect = el.getBoundingClientRect();
  state.positions[key] = { left: Math.round(rect.left), top: Math.round(rect.top) };
  saveState(state);
}

function restorePosition(key: 'fab' | 'panel', el: HTMLElement, fallback: () => { left: number; top: number }): void {
  const position = loadState().positions[key] ?? fallback();
  requestAnimationFrame(() => placeElement(el, position.left, position.top));
}

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  try {
    const win = getParentWindow() as unknown as { toastr?: Record<string, unknown> };
    const fn = win.toastr?.[type];
    if (typeof fn === 'function') (fn as (text: string) => void)(message);
  } catch {
    // Toasts are optional.
  }
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSms(text: string): string[] {
  const matches: string[] = [];
  const re = new RegExp(`<${escapeTag(SMS_TAG)}>([\\s\\S]*?)<\\/${escapeTag(SMS_TAG)}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1].trim();
    if (value) matches.push(value);
  }
  return matches;
}

function addPhoneMessage(role: PhoneRole, text: string, source?: string): void {
  const clean = text.trim();
  if (!clean) return;
  const state = loadState();
  const time = Date.now();
  state.messages.push({ id: uid(), role, text: clean, time, source });
  if (panelOpen) state.readUntil = time;
  saveState(state);
  renderMessages();
}

function markMessagesRead(): void {
  const state = loadState();
  state.readUntil = Date.now();
  saveState(state);
  renderMessages();
}

function deletePhoneMessage(id: string): void {
  const state = loadState();
  state.messages = state.messages.filter(message => message.id !== id);
  saveState(state);
  renderMessages();
}

function editPhoneMessage(id: string): void {
  const state = loadState();
  const message = state.messages.find(item => item.id === id);
  if (!message) return;
  const next = getParentWindow().prompt?.('编辑短信', message.text) ?? prompt('编辑短信', message.text);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  message.text = trimmed;
  message.time = Date.now();
  saveState(state);
  renderMessages();
}

function clearPhoneMessages(): void {
  const ok = getParentWindow().confirm?.('确定清空小手机里的所有短信？') ?? confirm('确定清空小手机里的所有短信？');
  if (!ok) return;
  const state = loadState();
  state.messages = [];
  state.seen = [];
  saveState(state);
  renderMessages();
}

function isUserChatMessage(message: Record<string, unknown>, win: Record<string, unknown>): boolean {
  if (message.is_user === true || message.isUser === true) return true;
  if (message.role === 'user' || message.role === 'human') return true;
  if (message.sender === 'user' || message.type === 'user') return true;
  return typeof message.name === 'string' && typeof win.name1 === 'string' && message.name === win.name1;
}

function isSystemChatMessage(message: Record<string, unknown>): boolean {
  return message.is_system === true || message.role === 'system' || message.role === 'narrator';
}

function readChatMessages(): ChatEntry[] {
  const win = getParentWindow() as unknown as Record<string, unknown>;

  try {
    const getLast =
      typeof getLastMessageId === 'function'
        ? getLastMessageId
        : typeof win.getLastMessageId === 'function'
          ? (win.getLastMessageId as () => number)
          : null;
    const getMessages =
      typeof getChatMessages === 'function'
        ? getChatMessages
        : typeof win.getChatMessages === 'function'
          ? (win.getChatMessages as typeof getChatMessages)
          : null;

    const last = getLast ? getLast() : -1;
    if (last >= 0 && getMessages) {
      return getMessages(`0-${last}`, { role: 'all', hide_state: 'all', include_swipes: false })
        .map((message, index) => ({
          id: String(message.message_id ?? index),
          text: typeof message.message === 'string' ? message.message : '',
          isUser: isUserChatMessage(message as unknown as Record<string, unknown>, win) || isSystemChatMessage(message as unknown as Record<string, unknown>),
        }))
        .filter(message => message.text.trim());
    }
  } catch {
    // Fall through to SillyTavern globals.
  }

  const st = win.SillyTavern as { chat?: Array<{ mes?: unknown; mesid?: unknown; is_user?: unknown; role?: unknown; name?: unknown; is_system?: unknown }> } | undefined;
  if (Array.isArray(st?.chat)) {
    return st.chat
      .map((message, index) => ({
        id: String(message.mesid ?? index),
        text: typeof message.mes === 'string' ? message.mes : '',
        isUser: isUserChatMessage(message as Record<string, unknown>, win) || isSystemChatMessage(message as Record<string, unknown>),
      }))
      .filter(message => message.text.trim());
  }

  const context = typeof (win.SillyTavern as { getContext?: unknown } | undefined)?.getContext === 'function'
    ? ((win.SillyTavern as { getContext: () => { chat?: Array<{ mes?: unknown; mesid?: unknown; is_user?: unknown; role?: unknown; name?: unknown; is_system?: unknown }> } }).getContext())
    : null;
  if (Array.isArray(context?.chat)) {
    return context.chat
      .map((message, index) => ({
        id: String(message.mesid ?? index),
        text: typeof message.mes === 'string' ? message.mes : '',
        isUser: isUserChatMessage(message as Record<string, unknown>, win) || isSystemChatMessage(message as Record<string, unknown>),
      }))
      .filter(message => message.text.trim());
  }

  return [];
}

function syncFromChat(showResult = false): number {
  const state = loadState();
  const seen = new Set(state.seen);
  let added = 0;

  for (const chatMessage of readChatMessages()) {
    if (chatMessage.isUser) continue;
    extractSms(chatMessage.text).forEach((text, index) => {
      const signature = `${chatMessage.id}:${index}:${hashText(text)}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      state.messages.push({ id: uid(), role: 'char', text, time: Date.now(), source: signature });
      added += 1;
    });
  }

  state.seen = Array.from(seen).slice(-MAX_SEEN);
  saveState(state);
  renderMessages();

  if (showResult) {
    toast(added > 0 ? `读取到 ${added} 条短信` : '没有发现新的历史短信', added > 0 ? 'success' : 'info');
  }
  return added;
}

function findInput(): HTMLElement | null {
  const selectors = [
    '#send_textarea',
    'textarea#send_textarea',
    '#send_form textarea',
    'textarea.send_text',
    '#send_form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
  ];
  for (const selector of selectors) {
    const input = hostDocument.querySelector<HTMLElement>(selector);
    if (input && !input.closest(`#${ROOT_ID}`)) return input;
  }
  return null;
}

function findSendButton(): HTMLElement | null {
  const selectors = ['#send_but', '#send_form #send_but', '.send_button', 'button[aria-label="Send"]', '#send_form button'];
  for (const selector of selectors) {
    const button = hostDocument.querySelector<HTMLElement>(selector);
    if (button && !button.closest(`#${ROOT_ID}`)) return button;
  }
  return null;
}

function setInputValue(input: HTMLElement, value: string): void {
  const win = hostDocument.defaultView ?? getParentWindow();
  if (input instanceof win.HTMLTextAreaElement || input instanceof win.HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  } else if (input.isContentEditable) {
    input.textContent = value;
  }

  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));

  const jq = (getParentWindow() as unknown as { $?: unknown }).$;
  if (typeof jq === 'function') {
    const wrapped = (jq as (el: Element) => { val?: (value: string) => unknown; trigger: (event: string) => unknown })(input);
    wrapped.val?.(value);
    wrapped.trigger('input');
    wrapped.trigger('change');
  }
}

function clickSend(button: HTMLElement): void {
  const win = hostDocument.defaultView ?? getParentWindow();
  ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
    button.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
  });
}

function sendToTavern(text: string): boolean {
  const wrapped = `<${SMS_TAG}>${text.trim()}</${SMS_TAG}>`;
  const input = findInput();
  if (!input) {
    toast('没有找到酒馆输入框', 'warning');
    return false;
  }

  setInputValue(input, wrapped);
  input.focus();

  const button = findSendButton();
  if (button) {
    clickSend(button);
    toast('短信已写回酒馆并发送', 'success');
    return true;
  }

  toast('短信已写入酒馆输入框，请手动发送', 'info');
  return true;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return hostDocument.getElementById(id) as T | null;
}

function installStyle(): void {
  const oldStyle = hostDocument.getElementById(STYLE_ID);
  oldStyle?.remove();
  const style = hostDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = phoneCss;
  hostDocument.head.appendChild(style);
}

function createButton(label: string, className: string, title?: string): HTMLButtonElement {
  const button = hostDocument.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (title) button.title = title;
  return button;
}

function buildUi(): void {
  hostDocument.getElementById(ROOT_ID)?.remove();
  installStyle();

  const container = hostDocument.createElement('div');
  container.id = ROOT_ID;
  container.innerHTML = `
    <button id="xp-fab" class="xp-fab" type="button" aria-label="打开小手机">
      <span class="xp-fab__screen"></span>
      <span id="xp-badge" class="xp-badge" hidden>0</span>
    </button>
    <section id="xp-panel" class="xp-panel xp-panel--hidden" aria-label="小手机短信窗口">
      <header id="xp-titlebar" class="xp-titlebar">
        <div>
          <div class="xp-titlebar__name">小手机</div>
          <div class="xp-titlebar__sub">${VERSION} · &lt;${SMS_TAG}&gt;</div>
        </div>
        <div class="xp-titlebar__actions">
          <button id="xp-sync" class="xp-icon-btn" type="button" title="读取过去聊天记录">读</button>
          <button id="xp-clear" class="xp-icon-btn" type="button" title="清空短信">清</button>
          <button id="xp-close" class="xp-icon-btn" type="button" title="关闭">×</button>
        </div>
      </header>
      <main id="xp-messages" class="xp-messages"></main>
      <footer class="xp-composer">
        <textarea id="xp-input" class="xp-input" rows="1" placeholder="输入短信"></textarea>
        <button id="xp-send" class="xp-send" type="button" disabled>发送</button>
      </footer>
    </section>
  `;
  hostDocument.body.appendChild(container);

  const fab = byId<HTMLElement>('xp-fab');
  const panel = byId<HTMLElement>('xp-panel');
  if (!fab || !panel) return;

  restorePosition('fab', fab, () => {
    const view = viewport();
    return { left: view.width - 76, top: view.height - 84 };
  });
  restorePosition('panel', panel, () => {
    const view = viewport();
    return { left: Math.max(8, view.width - 364), top: Math.max(8, view.height - 624) };
  });
}

function openPanel(force = true): void {
  const panel = byId<HTMLElement>('xp-panel');
  const fab = byId<HTMLElement>('xp-fab');
  if (!panel) return;
  panelOpen = force ? true : !panelOpen;
  panel.classList.toggle('xp-panel--hidden', !panelOpen);
  fab?.classList.toggle('xp-fab--active', panelOpen);
  if (!panelOpen) return;

  setStyle(panel, 'display', 'flex');
  setStyle(panel, 'visibility', 'visible');
  setStyle(panel, 'opacity', '1');
  setStyle(panel, 'pointer-events', 'auto');
  keepPanelVisible(panel);
  syncFromChat(false);
  markMessagesRead();
  scrollMessagesToBottom();
}

function closePanel(): void {
  const panel = byId<HTMLElement>('xp-panel');
  const fab = byId<HTMLElement>('xp-fab');
  panelOpen = false;
  panel?.classList.add('xp-panel--hidden');
  if (panel) setStyle(panel, 'display', 'none');
  fab?.classList.remove('xp-fab--active');
}

function keepPanelVisible(panel: HTMLElement): void {
  requestAnimationFrame(() => {
    const view = viewport();
    const mobile = view.width <= 520;
    if (mobile) {
      panel.classList.toggle('xp-panel--keyboard', view.keyboardInset > 32);
      panel.style.setProperty('--xp-keyboard-inset', `${Math.round(view.keyboardInset)}px`);
      setStyle(panel, 'width', `${Math.max(288, view.width - 16)}px`);
      setStyle(panel, 'height', `${Math.max(260, view.height - 16)}px`);
      placeElement(panel, 8, Math.max(8, view.offsetTop + 8));
      rememberPosition('panel', panel);
      return;
    }

    panel.classList.remove('xp-panel--keyboard');
    panel.style.removeProperty('--xp-keyboard-inset');
    setStyle(panel, 'width', '340px');
    setStyle(panel, 'height', `${Math.min(560, view.height - 24)}px`);
    const rect = panel.getBoundingClientRect();
    const outside = rect.left < 0 || rect.top < 0 || rect.right > view.width || rect.bottom > view.height;
    if (outside || rect.width < 240 || rect.height < 300) {
      placeElement(panel, view.width - 364, Math.max(8, view.height - rect.height - 88));
      rememberPosition('panel', panel);
    } else {
      placeElement(panel, rect.left, rect.top);
    }
  });
}

function renderMessages(): void {
  const list = byId<HTMLElement>('xp-messages');
  if (!list) return;
  const state = loadState();
  const messages = state.messages;
  list.innerHTML = '';

  if (messages.length === 0) {
    const empty = hostDocument.createElement('div');
    empty.className = 'xp-empty';
    empty.textContent = `还没有短信。AI 回复里写 <${SMS_TAG}>内容</${SMS_TAG}> 后会自动出现在这里。`;
    list.appendChild(empty);
  } else {
    for (const message of messages) {
      const item = hostDocument.createElement('article');
      item.className = `xp-msg xp-msg--${message.role}`;
      item.dataset.id = message.id;

      const bubble = hostDocument.createElement('div');
      bubble.className = 'xp-msg__bubble';
      bubble.textContent = message.text;

      const meta = hostDocument.createElement('div');
      meta.className = 'xp-msg__meta';
      meta.textContent = formatTime(message.time);

      const actions = hostDocument.createElement('div');
      actions.className = 'xp-msg__actions';
      const edit = createButton('改', 'xp-msg__action', '编辑短信');
      const del = createButton('删', 'xp-msg__action xp-msg__action--danger', '删除短信');
      edit.addEventListener('click', () => editPhoneMessage(message.id));
      del.addEventListener('click', () => deletePhoneMessage(message.id));
      actions.append(edit, del);

      item.append(bubble, actions, meta);
      list.appendChild(item);
    }
  }

  const badge = byId<HTMLElement>('xp-badge');
  const unread = panelOpen ? 0 : messages.filter(message => message.role === 'char' && message.time > (state.readUntil ?? 0)).length;
  if (badge) {
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  }
}

function scrollMessagesToBottom(): void {
  const list = byId<HTMLElement>('xp-messages');
  if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

function bindDrag(el: HTMLElement, handle: HTMLElement, key: 'fab' | 'panel', onTap?: () => void): void {
  const win = hostDocument.defaultView ?? window;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  const start = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const target = event.target as HTMLElement | null;
    if (key === 'panel' && target?.closest('button, textarea, input, select, a')) return;
    const rect = el.getBoundingClientRect();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    moved = false;
    el.classList.add('xp-dragging');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const move = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    placeElement(el, startLeft + dx, startTop + dy);
    event.preventDefault();
    event.stopPropagation();
  };

  const end = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    el.classList.remove('xp-dragging');
    handle.releasePointerCapture?.(event.pointerId);
    if (moved) rememberPosition(key, el);
    else onTap?.();
    event.preventDefault();
    event.stopPropagation();
  };

  handle.addEventListener('pointerdown', start, { capture: true });
  win.addEventListener('pointermove', move, { capture: true });
  win.addEventListener('pointerup', end, { capture: true });
  win.addEventListener('pointercancel', end, { capture: true });
  cleanupFns.push(() => {
    handle.removeEventListener('pointerdown', start, { capture: true });
    win.removeEventListener('pointermove', move, { capture: true });
    win.removeEventListener('pointerup', end, { capture: true });
    win.removeEventListener('pointercancel', end, { capture: true });
  });
}

function bindUi(): void {
  const fab = byId<HTMLElement>('xp-fab');
  const panel = byId<HTMLElement>('xp-panel');
  const titlebar = byId<HTMLElement>('xp-titlebar');
  const input = byId<HTMLTextAreaElement>('xp-input');
  const send = byId<HTMLButtonElement>('xp-send');
  if (!fab || !panel || !titlebar) return;

  bindDrag(fab, fab, 'fab', () => openPanel(true));
  bindDrag(panel, titlebar, 'panel');

  fab.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel(true);
    }
  });

  byId<HTMLButtonElement>('xp-close')?.addEventListener('click', closePanel);
  byId<HTMLButtonElement>('xp-sync')?.addEventListener('click', () => syncFromChat(true));
  byId<HTMLButtonElement>('xp-clear')?.addEventListener('click', clearPhoneMessages);

  const doSend = (): void => {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    addPhoneMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    if (send) send.disabled = true;
    sendToTavern(text);
    scrollMessagesToBottom();
  };

  send?.addEventListener('click', doSend);
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(92, input.scrollHeight)}px`;
    if (send) send.disabled = !input.value.trim();
    if (panelOpen) keepPanelVisible(panel);
  });
  input?.addEventListener('focus', () => {
    if (!panelOpen) return;
    keepPanelVisible(panel);
    window.setTimeout(() => keepPanelVisible(panel), 120);
    window.setTimeout(() => keepPanelVisible(panel), 320);
  });
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      doSend();
    }
  });

  const win = hostDocument.defaultView ?? window;
  const fitViewport = (): void => {
    if (panelOpen) keepPanelVisible(panel);
    const fabRect = fab.getBoundingClientRect();
    placeElement(fab, fabRect.left, fabRect.top);
  };
  win.addEventListener('resize', fitViewport);
  win.visualViewport?.addEventListener('resize', fitViewport);
  win.visualViewport?.addEventListener('scroll', fitViewport);
  cleanupFns.push(() => {
    win.removeEventListener('resize', fitViewport);
    win.visualViewport?.removeEventListener('resize', fitViewport);
    win.visualViewport?.removeEventListener('scroll', fitViewport);
  });
}

function listenToTavernEvents(): void {
  const win = getParentWindow() as unknown as Record<string, unknown>;
  const eventSource = win.eventSource as { on?: (event: string, cb: (...args: unknown[]) => void) => unknown; off?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void } | undefined;

  const run = (): void => { syncFromChat(false); };
  const events = ['MESSAGE_RECEIVED', 'GENERATION_AFTER_COMMANDS', 'CHAT_CHANGED'];

  if (eventSource && typeof eventSource.on === 'function') {
    events.forEach(eventName => {
      eventSource.on?.(eventName, run);
      cleanupFns.push(() => {
        eventSource.off?.(eventName, run);
        eventSource.removeListener?.(eventName, run);
      });
    });
  }

  const timer = window.setInterval(run, 2500);
  cleanupFns.push(() => window.clearInterval(timer));
}

function init(): void {
  hostDocument = getHostDocument();
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
  buildUi();
  renderMessages();
  bindUi();
  listenToTavernEvents();
  syncFromChat(false);
  toast(`小手机已启动 ${VERSION}`, 'info');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
