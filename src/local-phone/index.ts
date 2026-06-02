import './styles.css';

declare global {
  interface Window {
    Vue?: unknown;
    Pinia?: {
      getActivePinia?: () => { _s?: Map<string, unknown> };
    };
    SillyTavern?: Record<string, unknown>;
    tavern_events?: Record<string, string>;
    iframe_events?: Record<string, string>;
    toastr?: Record<string, unknown>;
    $?: unknown;
    _?: unknown;
    z?: unknown;
  }
}

type Listener = (...args: unknown[]) => void | Promise<void>;
type WorldbookEntry = Record<string, unknown> & { name?: string };
type WorldbookMap = Record<string, WorldbookEntry[]>;

interface ChatMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: string;
  read: boolean;
  importedFromCard?: boolean;
}

interface ChatRecord {
  contactName: string;
  messages: ChatMessage[];
  lastUpdate: number;
}

interface ImportedRoleCard {
  name: string;
  nickname?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  tags: string[];
  raw: Record<string, unknown>;
  hash: string;
}

interface LocalLlmConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

interface LocalModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MiniPhoneStore {
  activeApp?: string;
  phoneData: {
    device: { owner?: string };
    contacts: Record<string, Record<string, unknown>>;
    conversations: Record<
      string,
      { messages: ChatMessage[]; lastUpdate: number; unread: number }
    >;
  };
  addContact?: (name: string) => void;
  reportAction?: (action: Record<string, unknown>) => void;
  saveToWorldbook?: () => Promise<void>;
}

const CARD_STORAGE_KEY = 'local-phone-imported-card';
const OWNER_STORAGE_KEY = 'local-phone-owner-name';
const WORLDBOOK_STORAGE_KEY = 'local-phone-worldbooks';
const AUTO_ADAPT_STORAGE_KEY = 'local-phone-auto-adapt-enabled';
const LAST_ADAPTED_HASH_KEY = 'local-phone-last-adapted-card-hash';
const LLM_CONFIG_STORAGE_KEY = 'local-phone-llm-config';
const WORLDBOOK_NAME = '[小手机数据]';
const PHONE_DATA_ENTRY_NAME = '[手机数据]';
const ASSET_VERSION = 'local-20260602-independent-reply';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app');
}

app.innerHTML = `
  <div class="shim-toolbar">
    <div>
      <strong>小手机原版本地运行中</strong>
      <span>已注入本地 SillyTavern shim。角色卡可在设置里导入并适配应用。</span>
    </div>
    <label class="import-button">
      导入角色卡
      <input id="card-file" type="file" accept=".json,application/json" />
    </label>
  </div>
  <div id="shim-log" class="shim-log">正在加载原版小手机...</div>
`;

const listeners = new Map<string, Set<Listener>>();
const logs = document.querySelector<HTMLDivElement>('#shim-log');

function log(message: string): void {
  if (logs) {
    logs.textContent = message;
  }
  console.info(`[local-phone-shim] ${message}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

function emit(event: string, ...args: unknown[]): void {
  listeners.get(event)?.forEach(listener => {
    void listener(...args);
  });
}

function on(event: string, listener: Listener): { stop: () => void } {
  const set = listeners.get(event) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(event, set);
  return {
    stop: () => set.delete(listener),
  };
}

function noopResult<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function readWorldbooks(): WorldbookMap {
  return readJson<WorldbookMap>(WORLDBOOK_STORAGE_KEY, {});
}

function sanitizePhoneDataEntry(entry: WorldbookEntry): WorldbookEntry {
  if (entry.name !== PHONE_DATA_ENTRY_NAME || typeof entry.content !== 'string') {
    return entry;
  }
  try {
    const phoneData = JSON.parse(entry.content) as Record<string, unknown>;
    if (!isRecord(phoneData)) {
      return entry;
    }
    return {
      ...entry,
      content: JSON.stringify({
        ...phoneData,
        contacts: isRecord(phoneData.contacts) ? phoneData.contacts : {},
        conversations: isRecord(phoneData.conversations) ? phoneData.conversations : {},
        apps: {},
      }),
    };
  } catch {
    return entry;
  }
}

function sanitizeWorldbooks(worldbooks: WorldbookMap): WorldbookMap {
  return Object.fromEntries(
    Object.entries(worldbooks).map(([name, entries]) => [
      name,
      Array.isArray(entries) ? entries.map(entry => sanitizePhoneDataEntry(entry)) : [],
    ]),
  );
}

function writeWorldbooks(worldbooks: WorldbookMap): void {
  writeJson(WORLDBOOK_STORAGE_KEY, sanitizeWorldbooks(worldbooks));
}

function ensureWorldbookMapEntry(worldbooks: WorldbookMap, name: string): WorldbookEntry[] {
  if (!worldbooks[name]) {
    worldbooks[name] = [];
  }
  return worldbooks[name];
}

function getLocalWorldbookNames(): string[] {
  return Object.keys(readWorldbooks());
}

function getLocalWorldbook(name: string): WorldbookEntry[] {
  return readWorldbooks()[name] ?? [];
}

async function createLocalWorldbook(name: string): Promise<void> {
  const worldbooks = readWorldbooks();
  ensureWorldbookMapEntry(worldbooks, name);
  writeWorldbooks(worldbooks);
}

async function createLocalWorldbookEntries(
  name: string,
  entries: WorldbookEntry[],
): Promise<WorldbookEntry[]> {
  const worldbooks = readWorldbooks();
  ensureWorldbookMapEntry(worldbooks, name).push(...entries);
  writeWorldbooks(worldbooks);
  return entries;
}

async function updateLocalWorldbookWith(
  name: string,
  updater: (entries: WorldbookEntry[]) => WorldbookEntry[] | void,
): Promise<void> {
  const worldbooks = readWorldbooks();
  const entries = [...ensureWorldbookMapEntry(worldbooks, name)];
  worldbooks[name] = updater(entries) ?? entries;
  writeWorldbooks(worldbooks);
}

async function deleteLocalWorldbookEntries(
  name: string,
  matcher: ((entry: WorldbookEntry) => boolean) | string[] | undefined,
): Promise<void> {
  const worldbooks = readWorldbooks();
  const entries = worldbooks[name] ?? [];
  if (typeof matcher === 'function') {
    worldbooks[name] = entries.filter(entry => !matcher(entry));
  } else if (Array.isArray(matcher)) {
    const names = new Set(matcher);
    worldbooks[name] = entries.filter(entry => !entry.name || !names.has(entry.name));
  } else {
    worldbooks[name] = [];
  }
  writeWorldbooks(worldbooks);
}

function installShim(): void {
  const savedCard = localStorage.getItem(CARD_STORAGE_KEY);
  const ownerName = localStorage.getItem(OWNER_STORAGE_KEY) || '用户';
  const characterName = savedCard ? readCardName(savedCard) : '角色';

  window.tavern_events = {
    CHAT_CHANGED: 'CHAT_CHANGED',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  };
  window.iframe_events = {
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'STREAM_TOKEN_RECEIVED_INCREMENTALLY',
  };

  window.SillyTavern = {
    name1: ownerName,
    name2: characterName,
    getCurrentChatId: () => 'local-chat',
  };

  Object.assign(window, {
    getScriptId: () => 'local-phone-original',
    eventOn: on,
    getChatMessages: () => [],
    createChatMessages: (messages: unknown[]) => {
      const saved = JSON.parse(localStorage.getItem('local-phone-chat-messages') ?? '[]') as unknown[];
      saved.push(...messages);
      localStorage.setItem('local-phone-chat-messages', JSON.stringify(saved));
      log(`已记录 ${messages.length} 条本地聊天写回`);
      return noopResult(messages);
    },
    setChatMessages: () => noopResult(undefined),
    generateRaw: async ({ user_input }: { user_input?: string }) => {
      const text = user_input ? String(user_input).slice(0, 160) : '本地模式暂无 AI 输出';
      emit('STREAM_TOKEN_RECEIVED_INCREMENTALLY', text);
      return text;
    },
    stopAllGeneration: () => undefined,
    injectPrompts: () => ({ uninject: () => undefined }),
    getWorldbookNames: getLocalWorldbookNames,
    createWorldbook: createLocalWorldbook,
    getWorldbook: (name: string) => noopResult(getLocalWorldbook(name)),
    createWorldbookEntries: createLocalWorldbookEntries,
    updateWorldbookWith: updateLocalWorldbookWith,
    deleteWorldbookEntries: deleteLocalWorldbookEntries,
    getCharWorldbookNames: () => ({ primary: WORLDBOOK_NAME, additional: [] }),
    getChatWorldbookName: () => WORLDBOOK_NAME,
    getOrCreateChatWorldbook: async (_chat: string, name: string) => {
      await createLocalWorldbook(name || WORLDBOOK_NAME);
      return name || WORLDBOOK_NAME;
    },
    getCurrentCharacterName: () => readSavedCardName(),
    getCurrentCharacter: () => ({ name: readSavedCardName(), card: readSavedCardRaw() }),
  });
}

function installTinyGlobals(): void {
  window.toastr = {
    info: (...args: unknown[]) => log(String(args[0] ?? 'info')),
    warning: (...args: unknown[]) => log(String(args[0] ?? 'warning')),
    error: (...args: unknown[]) => log(String(args[0] ?? 'error')),
    success: (...args: unknown[]) => log(String(args[0] ?? 'success')),
  };

  window._ = {
    clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
    debounce: <T extends (...args: unknown[]) => void>(fn: T) => fn,
    random: (min: number, max?: number) => {
      if (max === undefined) {
        return Math.floor(Math.random() * (min + 1));
      }
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
  };
}

function installErrorReporter(): void {
  window.addEventListener('error', event => {
    const where = event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : '';
    log(`运行错误：${event.message}${where}`);
  });
  window.addEventListener('unhandledrejection', event => {
    log(`异步错误：${formatError(event.reason)}`);
  });
}

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载失败：${src}`));
    document.head.appendChild(script);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function normalizeTags(...values: unknown[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    if (Array.isArray(value)) {
      value.forEach(item => {
        const text = stringValue(item);
        if (text) {
          tags.add(text);
        }
      });
    } else {
      const text = stringValue(value);
      if (text) {
        text
          .split(/[，,、\s]+/)
          .map(tag => tag.trim())
          .filter(Boolean)
          .forEach(tag => tags.add(tag));
      }
    }
  }
  return [...tags].slice(0, 6);
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readCardName(rawText: string): string {
  try {
    return parseRoleCard(rawText).name;
  } catch {
    return '角色';
  }
}

function readSavedCardName(): string {
  const saved = localStorage.getItem(CARD_STORAGE_KEY);
  return saved ? readCardName(saved) : '角色';
}

function readSavedCardRaw(): Record<string, unknown> | null {
  const saved = localStorage.getItem(CARD_STORAGE_KEY);
  if (!saved) {
    return null;
  }
  try {
    return JSON.parse(saved) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseRoleCard(rawText: string): ImportedRoleCard {
  const raw = JSON.parse(rawText) as Record<string, unknown>;
  const data = isRecord(raw.data) ? raw.data : {};
  const extensions = isRecord(data.extensions) ? data.extensions : {};
  const chub = isRecord(extensions.chub) ? extensions.chub : {};
  const name = firstString(data.name, raw.name, data.char_name, raw.char_name);
  if (!name) {
    throw new Error('角色卡缺少 name');
  }

  const nickname = firstString(
    data.nickname,
    raw.nickname,
    data.display_name,
    data.creator_notes,
  );
  const description = firstString(data.description, raw.description);
  const personality = firstString(data.personality, raw.personality);
  const scenario = firstString(data.scenario, raw.scenario);
  const firstMessage = firstString(data.first_mes, raw.first_mes, data.first_message);
  const tags = normalizeTags(data.tags, raw.tags, chub.tags, '角色卡');

  return {
    name,
    nickname: nickname && nickname.length <= 24 ? nickname : undefined,
    description,
    personality,
    scenario,
    firstMessage,
    tags: tags.length > 0 ? tags : ['角色卡'],
    raw,
    hash: stableHash(rawText),
  };
}

function compactText(text: string | undefined, maxLength: number): string {
  if (!text) {
    return '';
  }
  const compact = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{user\}\}/gi, '你')
    .replace(/\{\{char\}\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function deterministicNumber(name: string): string {
  let total = 0;
  for (const char of name) {
    total += char.charCodeAt(0);
  }
  return String(((total * 7919) % 9000000) + 1000000);
}

function shouldAutoAdapt(): boolean {
  return localStorage.getItem(AUTO_ADAPT_STORAGE_KEY) !== 'false';
}

function setAutoAdapt(enabled: boolean): void {
  localStorage.setItem(AUTO_ADAPT_STORAGE_KEY, enabled ? 'true' : 'false');
}

function readLocalLlmConfig(): LocalLlmConfig {
  const saved = readJson<Partial<LocalLlmConfig>>(LLM_CONFIG_STORAGE_KEY, {});
  return {
    apiUrl: typeof saved.apiUrl === 'string' ? saved.apiUrl : '',
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    model: typeof saved.model === 'string' ? saved.model : '',
    temperature: typeof saved.temperature === 'number' ? saved.temperature : 0.75,
  };
}

function saveLocalLlmConfig(config: LocalLlmConfig): void {
  writeJson(LLM_CONFIG_STORAGE_KEY, {
    apiUrl: config.apiUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    temperature: Math.min(Math.max(config.temperature, 0), 2),
  });
}

function normalizeChatCompletionsUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function assertLocalLlmConfigured(): LocalLlmConfig {
  const config = readLocalLlmConfig();
  if (!normalizeChatCompletionsUrl(config.apiUrl) || !config.model.trim()) {
    throw new Error('请先在设置里填写独立回复的 API 地址和模型');
  }
  return config;
}

function getMiniPhoneStore(): MiniPhoneStore | null {
  const store = window.Pinia?.getActivePinia?.()?._s?.get('mini-phone');
  return store && typeof store === 'object' ? (store as MiniPhoneStore) : null;
}

async function waitForMiniPhoneStore(timeoutMs = 4000): Promise<MiniPhoneStore | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const store = getMiniPhoneStore();
    if (store) {
      return store;
    }
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  return getMiniPhoneStore();
}

function getOwnerName(store?: MiniPhoneStore | null): string {
  return (
    store?.phoneData.device.owner ||
    (typeof window.SillyTavern?.name1 === 'string' ? window.SillyTavern.name1 : '') ||
    '用户'
  );
}

function ensurePhoneDataContact(store: MiniPhoneStore, card: ImportedRoleCard): void {
  const now = Date.now();
  store.addContact?.(card.name);
  if (!store.phoneData.contacts[card.name]) {
    store.phoneData.contacts[card.name] = { name: card.name, addedAt: now, tags: [] };
  }
  const contact = store.phoneData.contacts[card.name];
  contact.name = card.name;
  contact.addedAt = typeof contact.addedAt === 'number' ? contact.addedAt : now;
  contact.alias = card.nickname && card.nickname !== card.name ? card.nickname : contact.alias;
  contact.tags = [...new Set([...(Array.isArray(contact.tags) ? contact.tags : []), ...card.tags])];
  contact.qqNumber = deterministicNumber(card.name);
  contact.source = '角色卡导入';
  contact.signature = compactText(card.personality || card.description, 80);
  contact.description = compactText(card.description, 360);
  contact.personality = compactText(card.personality, 240);

  if (!store.phoneData.conversations[card.name]) {
    store.phoneData.conversations[card.name] = {
      messages: [],
      lastUpdate: now,
      unread: 0,
    };
  }
}

function buildInitialMessage(card: ImportedRoleCard, ownerName: string): ChatMessage | null {
  const content = compactText(card.firstMessage, 500);
  if (!content) {
    return null;
  }
  const timestamp = Date.now();
  return {
    id: `import_${card.hash}`,
    from: card.name,
    to: ownerName,
    content,
    timestamp,
    type: 'text',
    read: false,
    importedFromCard: true,
  };
}

function addInitialMessageToStore(
  store: MiniPhoneStore,
  card: ImportedRoleCard,
  message: ChatMessage | null,
): void {
  if (!message) {
    return;
  }
  const conversation = store.phoneData.conversations[card.name];
  if (!conversation.messages.some(item => item.id === message.id)) {
    conversation.messages.push(message);
    conversation.lastUpdate = message.timestamp;
    conversation.unread += 1;
  }
}

function createPhoneMessage(from: string, to: string, content: string, read: boolean): ChatMessage {
  const timestamp = Date.now();
  return {
    id: `local_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    content,
    timestamp,
    type: 'text',
    read,
  };
}

function appendMessageToStore(
  store: MiniPhoneStore,
  contactName: string,
  message: ChatMessage,
): void {
  const now = Date.now();
  if (!store.phoneData.conversations[contactName]) {
    store.phoneData.conversations[contactName] = {
      messages: [],
      lastUpdate: now,
      unread: 0,
    };
  }
  const conversation = store.phoneData.conversations[contactName];
  if (!conversation.messages.some(item => item.id === message.id)) {
    conversation.messages.push(message);
    conversation.lastUpdate = message.timestamp;
    if (message.from === contactName && !message.read) {
      conversation.unread += 1;
    }
  }
}

function openPhoneDatabase(): Promise<IDBDatabase> {
  const chatId =
    typeof window.SillyTavern?.getCurrentChatId === 'function'
      ? String(window.SillyTavern.getCurrentChatId())
      : 'local-chat';
  const dbName = `xiaoshouji-${chatId || 'default'}`;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('chat_records')) {
        db.createObjectStore('chat_records', { keyPath: 'contactName' });
      }
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: 'id' });
        store.createIndex('by_appId', 'appId', { unique: false });
        store.createIndex('by_type', 'type', { unique: false });
        store.createIndex('by_actor', 'actor', { unique: false });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('memory_core')) {
        const store = db.createObjectStore('memory_core', { keyPath: 'id' });
        store.createIndex('by_category', 'category', { unique: false });
        store.createIndex('by_source', 'source', { unique: false });
      }
      if (!db.objectStoreNames.contains('memory_chunks')) {
        const store = db.createObjectStore('memory_chunks', { keyPath: 'id' });
        store.createIndex('by_appId', 'appId', { unique: false });
        store.createIndex('by_source', 'source', { unique: false });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function writeImportedCardToIndexedDB(
  card: ImportedRoleCard,
  ownerName: string,
  message: ChatMessage | null,
): Promise<void> {
  const db = await openPhoneDatabase();
  try {
    const now = Date.now();
    const record = (await idbGet<ChatRecord>(db, 'chat_records', card.name)) ?? {
      contactName: card.name,
      messages: [],
      lastUpdate: now,
    };
    if (message && !record.messages.some(item => item.id === message.id)) {
      record.messages.push(message);
      record.lastUpdate = message.timestamp;
    }
    await idbPut(db, 'chat_records', record);
    await idbPut(db, 'events', {
      id: `evt_import_card_${card.hash}_${now}`,
      appId: 'messages',
      type: 'friend_added',
      actor: ownerName,
      summary: `用户在设置中通过角色卡添加了闪讯好友「${card.name}」`,
      data: {
        contactName: card.name,
        tags: card.tags,
        hasGreeting: Boolean(message),
      },
      timestamp: now,
    });
    await idbPut(db, 'memory_core', {
      id: `mem_import_card_${card.hash}`,
      category: 'relationship',
      characters: [card.name],
      content: `「${card.name}」已通过角色卡导入为闪讯好友。${compactText(
        card.description || card.personality,
        180,
      )}`,
      source: 'settings',
      timestamp: now,
    });
  } finally {
    db.close();
  }
}

async function writeFlashMessagesToIndexedDB(
  contactName: string,
  messages: ChatMessage[],
  eventSummary: string,
): Promise<void> {
  const db = await openPhoneDatabase();
  try {
    const now = Date.now();
    const record = (await idbGet<ChatRecord>(db, 'chat_records', contactName)) ?? {
      contactName,
      messages: [],
      lastUpdate: now,
    };
    for (const message of messages) {
      if (!record.messages.some(item => item.id === message.id)) {
        record.messages.push(message);
        record.lastUpdate = message.timestamp;
      }
    }
    await idbPut(db, 'chat_records', record);
    await idbPut(db, 'events', {
      id: `evt_flash_reply_${stableHash(`${contactName}_${now}`)}_${now}`,
      appId: 'messages',
      type: 'chat_reply',
      actor: contactName,
      summary: eventSummary,
      data: {
        contactName,
        messageCount: messages.length,
      },
      timestamp: now,
    });
  } finally {
    db.close();
  }
}

function buildFriendWorldbookContent(card: ImportedRoleCard, friendId: string): string {
  const parts = [
    `${card.name}是{{user}}的闪讯好友。`,
    card.nickname ? `闪讯昵称：${card.nickname}。` : '',
    `闪讯号：${friendId}。`,
    card.tags.length > 0 ? `标签：${card.tags.join('、')}。` : '',
    card.description ? `角色简介：${compactText(card.description, 220)}。` : '',
    card.personality ? `性格要点：${compactText(card.personality, 180)}。` : '',
    card.scenario ? `场景信息：${compactText(card.scenario, 160)}。` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function readSavedRoleCardForContact(contactName: string): ImportedRoleCard | null {
  const rawText = localStorage.getItem(CARD_STORAGE_KEY);
  if (!rawText) {
    return null;
  }
  try {
    const card = parseRoleCard(rawText);
    return card.name === contactName ? card : null;
  } catch {
    return null;
  }
}

function buildContactPrompt(
  store: MiniPhoneStore,
  contactName: string,
  ownerName: string,
): string {
  const card = readSavedRoleCardForContact(contactName);
  const contact = store.phoneData.contacts[contactName] ?? {};
  const parts = [
    `角色名：${contactName}`,
    `用户名：${ownerName}`,
    card?.nickname ? `昵称：${card.nickname}` : '',
    card?.description ? `角色简介：${compactText(card.description, 1400)}` : '',
    card?.personality ? `性格：${compactText(card.personality, 1000)}` : '',
    card?.scenario ? `场景：${compactText(card.scenario, 800)}` : '',
    !card && typeof contact.description === 'string'
      ? `联系人简介：${compactText(contact.description, 800)}`
      : '',
    !card && typeof contact.personality === 'string'
      ? `联系人性格：${compactText(contact.personality, 600)}`
      : '',
    Array.isArray(contact.tags) ? `标签：${contact.tags.join('、')}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function buildConversationPrompt(store: MiniPhoneStore, contactName: string, ownerName: string): string {
  const conversation = store.phoneData.conversations[contactName];
  const messages = conversation?.messages ?? [];
  return messages
    .slice(-14)
    .map(message => {
      const speaker = message.from === contactName ? contactName : ownerName;
      return `${speaker}：${compactText(message.content, 320)}`;
    })
    .join('\n');
}

function buildFlashReplyMessages(
  store: MiniPhoneStore,
  contactName: string,
  ownerName: string,
): LocalModelMessage[] {
  const roleContext = buildContactPrompt(store, contactName, ownerName);
  const chatHistory = buildConversationPrompt(store, contactName, ownerName);
  return [
    {
      role: 'system',
      content:
        '你正在独立驱动“小手机”的闪讯聊天。你必须扮演联系人本人回复用户，不要替用户说话，不要写旁白或解释。回复要像手机即时消息：自然、短、可直接显示在聊天气泡里。',
    },
    {
      role: 'system',
      content: `${roleContext}\n\n输出格式必须严格为：<message>回复内容</message>\n不要输出 Markdown、JSON、额外标签或解释。`,
    },
    {
      role: 'user',
      content: `以下是闪讯聊天记录，最后一条是用户刚发出的手机消息。请按角色口吻回复一条闪讯消息。\n\n${chatHistory}`,
    },
  ];
}

function extractPhoneMessageContent(rawText: string): string {
  const withoutThinking = rawText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  const messageMatch = withoutThinking.match(/<message>([\s\S]*?)<\/message>/i);
  const content = (messageMatch?.[1] ?? withoutThinking)
    .replace(/```[\s\S]*?```/g, text => text.replace(/```[a-z]*|```/gi, ''))
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!content) {
    throw new Error('模型没有返回可用的闪讯消息');
  }
  return content.length > 1000 ? `${content.slice(0, 999)}…` : content;
}

async function callLocalChatModel(messages: LocalModelMessage[]): Promise<string> {
  const config = assertLocalLlmConfigured();
  const url = normalizeChatCompletionsUrl(config.apiUrl);
  const requestBody = {
    model: config.model.trim(),
    messages,
    temperature: config.temperature,
    stream: false,
  };

  if (window.location.protocol !== 'file:') {
    const proxyResponse = await fetch('/local-phone-api/chat-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: url,
        apiKey: config.apiKey.trim(),
        ...requestBody,
      }),
    }).catch(() => null);

    if (proxyResponse?.ok) {
      return extractChatCompletionContent((await proxyResponse.json()) as Record<string, unknown>);
    }
    if (proxyResponse && proxyResponse.status !== 404) {
      const text = await proxyResponse.text().catch(() => '');
      throw new Error(`独立回复代理请求失败：${proxyResponse.status} ${text.slice(0, 220)}`);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`独立回复请求失败：${response.status} ${text.slice(0, 220)}`);
  }

  return extractChatCompletionContent((await response.json()) as Record<string, unknown>);
}

function extractChatCompletionContent(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : {};
  const content = firstString(
    isRecord(message) ? message.content : undefined,
    isRecord(firstChoice) ? firstChoice.text : undefined,
    isRecord(payload.message) ? payload.message.content : undefined,
    payload.response,
  );
  if (!content) {
    throw new Error('独立回复接口没有返回文本内容');
  }
  return extractPhoneMessageContent(content);
}

async function sendIndependentFlashReply(contactName: string, userText: string): Promise<string> {
  const store = await waitForMiniPhoneStore();
  if (!store) {
    throw new Error('小手机 store 尚未就绪');
  }
  const text = userText.trim();
  if (!text) {
    throw new Error('请输入要发送的闪讯消息');
  }
  if (!store.phoneData.contacts[contactName]) {
    throw new Error(`闪讯好友「${contactName}」不存在`);
  }
  assertLocalLlmConfigured();

  const ownerName = getOwnerName(store);
  const userMessage = createPhoneMessage(ownerName, contactName, text, true);
  appendMessageToStore(store, contactName, userMessage);
  await writeFlashMessagesToIndexedDB(contactName, [userMessage], `用户给「${contactName}」发送了一条闪讯消息`);
  await savePhoneDataSnapshot(store);

  if (window.SillyTavern) {
    window.SillyTavern.name2 = contactName;
  }

  const replyText = await callLocalChatModel(buildFlashReplyMessages(store, contactName, ownerName));
  const replyMessage = createPhoneMessage(contactName, ownerName, replyText, false);
  appendMessageToStore(store, contactName, replyMessage);
  await writeFlashMessagesToIndexedDB(
    contactName,
    [replyMessage],
    `「${contactName}」独立回复了一条闪讯消息`,
  );
  await savePhoneDataSnapshot(store);
  store.reportAction?.({
    appId: 'messages',
    action: '独立闪讯回复',
    summary: `用户给「${contactName}」发了闪讯消息，并收到独立回复`,
    data: { contactName, userMessage: text, reply: replyText },
  });
  return replyText;
}

async function writeFriendWorldbookEntry(card: ImportedRoleCard): Promise<void> {
  await createLocalWorldbook(WORLDBOOK_NAME);
  const entryName = `[好友]${card.name}`;
  const friendId = deterministicNumber(card.name);
  const content = buildFriendWorldbookContent(card, friendId);

  await updateLocalWorldbookWith(WORLDBOOK_NAME, entries => {
    const next = [...entries];
    const existingIndex = next.findIndex(entry => entry.name === entryName);
    const entry: WorldbookEntry = {
      name: entryName,
      enabled: true,
      content,
      strategy: {
        type: 'selective',
        keys: [card.name, card.nickname].filter(Boolean),
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: { type: 'before_character_definition', role: 'system', depth: 0, order: 1 },
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], ...entry };
    } else {
      next.push(entry);
    }
    return next;
  });
}

async function savePhoneDataSnapshot(store: MiniPhoneStore): Promise<void> {
  await createLocalWorldbook(WORLDBOOK_NAME);
  await updateLocalWorldbookWith(WORLDBOOK_NAME, entries => {
    const next = [...entries];
    const content = JSON.stringify({
      device: store.phoneData.device,
      contacts: store.phoneData.contacts,
      conversations: store.phoneData.conversations,
      apps: {},
    });
    const existingIndex = next.findIndex(entry => entry.name === PHONE_DATA_ENTRY_NAME);
    const entry: WorldbookEntry = {
      name: PHONE_DATA_ENTRY_NAME,
      enabled: false,
      content,
      strategy: {
        type: 'constant',
        keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: { type: 'before_character_definition', role: 'system', depth: 0, order: 100 },
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], ...entry };
    } else {
      next.push(entry);
    }
    return next;
  });
}

async function adaptRoleCardToPhone(card: ImportedRoleCard, force = false): Promise<string> {
  const store = await waitForMiniPhoneStore();
  if (!store) {
    throw new Error('小手机 store 尚未就绪');
  }
  if (
    !force &&
    localStorage.getItem(LAST_ADAPTED_HASH_KEY) === card.hash &&
    store.phoneData.contacts[card.name]
  ) {
    return `「${card.name}」已适配过`;
  }

  const ownerName = getOwnerName(store);
  ensurePhoneDataContact(store, card);
  const initialMessage = buildInitialMessage(card, ownerName);
  addInitialMessageToStore(store, card, initialMessage);
  store.reportAction?.({
    appId: 'messages',
    action: '导入角色卡好友',
    summary: `用户在设置中导入角色卡，并将「${card.name}」适配为闪讯好友`,
    data: { name: card.name, tags: card.tags },
  });

  await writeImportedCardToIndexedDB(card, ownerName, initialMessage);
  await writeFriendWorldbookEntry(card);
  await savePhoneDataSnapshot(store);
  localStorage.setItem(LAST_ADAPTED_HASH_KEY, card.hash);
  return `已将「${card.name}」适配为闪讯好友`;
}

async function importRoleCard(rawText: string, adapt: boolean): Promise<void> {
  const card = parseRoleCard(rawText);
  localStorage.setItem(CARD_STORAGE_KEY, rawText);
  if (window.SillyTavern) {
    window.SillyTavern.name2 = card.name;
  }

  if (adapt) {
    const message = await adaptRoleCardToPhone(card, true);
    log(`${message}，并写入通讯录/聊天记录`);
  } else {
    log(`已导入角色卡：${card.name}`);
  }
  updateSettingsAdapterStatus();
}

async function adaptSavedCard(force = false): Promise<void> {
  const rawText = localStorage.getItem(CARD_STORAGE_KEY);
  if (!rawText) {
    throw new Error('还没有导入角色卡');
  }
  const card = parseRoleCard(rawText);
  const message = await adaptRoleCardToPhone(card, force);
  log(message);
  updateSettingsAdapterStatus();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindCardImport(): void {
  document.querySelector<HTMLInputElement>('#card-file')?.addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      await importRoleCard(await file.text(), shouldAutoAdapt());
    } catch (error) {
      log(formatError(error));
    } finally {
      input.value = '';
    }
  });
}

function renderSettingsAdapter(): void {
  const scroll = document.querySelector<HTMLElement>('.settings-page .settings-scroll');
  if (!scroll || document.querySelector('#local-card-adapter')) {
    return;
  }

  const header = document.createElement('div');
  header.className = 'local-adapter-header';
  header.textContent = '角色卡适配';

  const group = document.createElement('div');
  group.id = 'local-card-adapter';
  group.className = 'local-adapter-group';
  group.innerHTML = `
    <div class="local-adapter-main">
      <div class="local-adapter-icon" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
      <div class="local-adapter-copy">
        <div class="local-adapter-title">导入角色卡</div>
        <div id="local-card-adapter-status" class="local-adapter-status"></div>
      </div>
    </div>
    <div class="local-adapter-actions">
      <label class="local-adapter-primary">
        导入
        <input id="local-settings-card-file" type="file" accept=".json,application/json" />
      </label>
      <button id="local-adapt-saved-card" class="local-adapter-secondary" type="button">适配已导入</button>
    </div>
    <label class="local-adapter-toggle">
      <input id="local-auto-adapt-card" type="checkbox" />
      <span>导入后自动适配应用</span>
    </label>
    <div class="local-adapter-chips">
      <span>闪讯好友</span>
      <span>通讯录</span>
      <span>聊天记录</span>
    </div>
  `;

  scroll.append(header, group);
  const fileInput = group.querySelector<HTMLInputElement>('#local-settings-card-file');
  const adaptButton = group.querySelector<HTMLButtonElement>('#local-adapt-saved-card');
  const autoCheckbox = group.querySelector<HTMLInputElement>('#local-auto-adapt-card');

  if (autoCheckbox) {
    autoCheckbox.checked = shouldAutoAdapt();
    autoCheckbox.addEventListener('change', () => {
      setAutoAdapt(autoCheckbox.checked);
      updateSettingsAdapterStatus();
    });
  }

  fileInput?.addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      await importRoleCard(await file.text(), true);
    } catch (error) {
      log(formatError(error));
    } finally {
      input.value = '';
    }
  });

  adaptButton?.addEventListener('click', async () => {
    try {
      await adaptSavedCard(true);
    } catch (error) {
      log(formatError(error));
      updateSettingsAdapterStatus(formatError(error).split('\n')[0]);
    }
  });

  updateSettingsAdapterStatus();
}

function updateSettingsAdapterStatus(message?: string): void {
  const status = document.querySelector<HTMLElement>('#local-card-adapter-status');
  if (!status) {
    return;
  }
  if (message) {
    status.textContent = message;
    return;
  }
  const saved = localStorage.getItem(CARD_STORAGE_KEY);
  if (!saved) {
    status.textContent = shouldAutoAdapt() ? '未导入，自动适配已开启' : '未导入，自动适配已关闭';
    return;
  }
  const name = readCardName(saved);
  const adapted = localStorage.getItem(LAST_ADAPTED_HASH_KEY) === stableHash(saved);
  status.textContent = `${name}${adapted ? '，已适配' : '，待适配'}`;
}

function renderReplySettings(): void {
  const scroll = document.querySelector<HTMLElement>('.settings-page .settings-scroll');
  if (!scroll || document.querySelector('#local-reply-config')) {
    return;
  }
  const config = readLocalLlmConfig();
  const header = document.createElement('div');
  header.className = 'local-adapter-header';
  header.textContent = '独立回复';

  const group = document.createElement('div');
  group.id = 'local-reply-config';
  group.className = 'local-adapter-group local-reply-config';
  group.innerHTML = `
    <div class="local-adapter-main">
      <div class="local-adapter-icon local-reply-icon" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
        </svg>
      </div>
      <div class="local-adapter-copy">
        <div class="local-adapter-title">闪讯模型</div>
        <div id="local-reply-config-status" class="local-adapter-status"></div>
      </div>
    </div>
    <div class="local-reply-fields">
      <label>
        <span>API 地址</span>
        <input id="local-llm-api-url" type="text" value="${escapeHtml(config.apiUrl)}" placeholder="https://example.com/v1" />
      </label>
      <label>
        <span>API Key</span>
        <input id="local-llm-api-key" type="password" value="${escapeHtml(config.apiKey)}" placeholder="sk-..." />
      </label>
      <label>
        <span>模型</span>
        <input id="local-llm-model" type="text" value="${escapeHtml(config.model)}" placeholder="gpt-4o-mini" />
      </label>
      <label>
        <span>温度</span>
        <input id="local-llm-temperature" type="number" min="0" max="2" step="0.05" value="${config.temperature}" />
      </label>
    </div>
    <div class="local-adapter-actions local-reply-actions">
      <button id="local-save-llm-config" class="local-adapter-primary" type="button">保存</button>
      <button id="local-test-llm-config" class="local-adapter-secondary" type="button">测试</button>
    </div>
  `;
  scroll.append(header, group);

  const saveButton = group.querySelector<HTMLButtonElement>('#local-save-llm-config');
  const testButton = group.querySelector<HTMLButtonElement>('#local-test-llm-config');
  const readFormConfig = (): LocalLlmConfig => ({
    apiUrl: group.querySelector<HTMLInputElement>('#local-llm-api-url')?.value ?? '',
    apiKey: group.querySelector<HTMLInputElement>('#local-llm-api-key')?.value ?? '',
    model: group.querySelector<HTMLInputElement>('#local-llm-model')?.value ?? '',
    temperature: Number(group.querySelector<HTMLInputElement>('#local-llm-temperature')?.value || '0.75'),
  });

  saveButton?.addEventListener('click', () => {
    saveLocalLlmConfig(readFormConfig());
    updateLocalReplyConfigStatus('已保存');
  });
  testButton?.addEventListener('click', async () => {
    try {
      saveLocalLlmConfig(readFormConfig());
      updateLocalReplyConfigStatus('测试中...');
      await callLocalChatModel([
        { role: 'system', content: '只输出 <message>连接成功</message>' },
        { role: 'user', content: '测试' },
      ]);
      updateLocalReplyConfigStatus('连接成功');
    } catch (error) {
      updateLocalReplyConfigStatus(formatError(error).split('\n')[0]);
    }
  });

  updateLocalReplyConfigStatus();
}

function updateLocalReplyConfigStatus(message?: string): void {
  const status = document.querySelector<HTMLElement>('#local-reply-config-status');
  if (!status) {
    return;
  }
  if (message) {
    status.textContent = message;
    return;
  }
  const config = readLocalLlmConfig();
  status.textContent = config.apiUrl && config.model ? `${config.model}，已配置` : '未配置';
}

function getFlashContactNames(store: MiniPhoneStore): string[] {
  return Object.keys(store.phoneData.contacts).filter(Boolean);
}

function renderIndependentReplyPanel(): void {
  const existing = document.querySelector<HTMLElement>('#local-flash-reply-panel');
  const store = getMiniPhoneStore();
  if (!store || store.activeApp !== 'messages') {
    existing?.remove();
    return;
  }
  if (existing) {
    return;
  }

  const host =
    document.querySelector<HTMLElement>('.app-page') ??
    document.querySelector<HTMLElement>('.phone-body');
  if (!host) {
    return;
  }

  const contacts = getFlashContactNames(store);
  const savedName = readSavedCardName();
  const selectedName = contacts.includes(savedName) ? savedName : contacts[0] ?? '';
  const panel = document.createElement('form');
  panel.id = 'local-flash-reply-panel';
  panel.className = 'local-flash-reply-panel';
  panel.innerHTML = `
    <div class="local-flash-reply-row">
      <select id="local-flash-contact" aria-label="闪讯好友">
        ${contacts
          .map(
            name =>
              `<option value="${escapeHtml(name)}" ${name === selectedName ? 'selected' : ''}>${escapeHtml(
                name,
              )}</option>`,
          )
          .join('')}
      </select>
      <button type="submit">发送并回复</button>
    </div>
    <textarea id="local-flash-message" rows="2" placeholder="输入要发送的手机消息"></textarea>
    <div id="local-flash-reply-status" class="local-flash-reply-status">${
      contacts.length > 0 ? '独立回复就绪' : '先导入角色卡'
    }</div>
  `;
  host.append(panel);

  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const select = panel.querySelector<HTMLSelectElement>('#local-flash-contact');
    const textarea = panel.querySelector<HTMLTextAreaElement>('#local-flash-message');
    const button = panel.querySelector<HTMLButtonElement>('button[type="submit"]');
    const status = panel.querySelector<HTMLElement>('#local-flash-reply-status');
    if (!select || !textarea || !button || !status) {
      return;
    }
    try {
      button.disabled = true;
      status.textContent = '正在回复...';
      const reply = await sendIndependentFlashReply(select.value, textarea.value);
      textarea.value = '';
      status.textContent = `已回复：${compactText(reply, 80)}`;
    } catch (error) {
      status.textContent = formatError(error).split('\n')[0];
    } finally {
      button.disabled = false;
    }
  });
}

function installSettingsCardAdapter(): void {
  renderSettingsAdapter();
  renderReplySettings();
  renderIndependentReplyPanel();
  const observer = new MutationObserver(() => {
    renderSettingsAdapter();
    renderReplySettings();
    renderIndependentReplyPanel();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function autoAdaptSavedCardIfNeeded(): Promise<void> {
  const rawText = localStorage.getItem(CARD_STORAGE_KEY);
  if (!rawText || !shouldAutoAdapt()) {
    return;
  }
  const card = parseRoleCard(rawText);
  if (localStorage.getItem(LAST_ADAPTED_HASH_KEY) === card.hash) {
    const store = await waitForMiniPhoneStore();
    if (store?.phoneData.contacts[card.name]) {
      return;
    }
  }
  try {
    const message = await adaptRoleCardToPhone(card, false);
    log(message);
    updateSettingsAdapterStatus();
  } catch (error) {
    console.warn('[local-phone-shim] 自动适配角色卡失败:', error);
  }
}

async function boot(): Promise<void> {
  installShim();
  installTinyGlobals();
  installErrorReporter();
  bindCardImport();

  try {
    await loadScript('./jquery.min.js');
    await loadScript('./lodash.min.js');
    await loadScript('./vue.global.prod.js');
    await loadScript('./pinia.iife.prod.js');
    await import(/* webpackIgnore: true */ `./zod-global.js?v=${ASSET_VERSION}`);
    log('运行时已加载，正在启动原版 bundle...');
    await import(/* webpackIgnore: true */ `./phone-original.js?v=${ASSET_VERSION}`);
    log('原版小手机 bundle 已启动');
    installSettingsCardAdapter();
    await autoAdaptSavedCardIfNeeded();
  } catch (error) {
    log(formatError(error));
  }
}

void boot();
