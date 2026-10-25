import { createHash } from 'node:crypto';

const string = (maxLength) => ({ type: 'string', maxLength });
const tool = (name, description, properties) => ({ type: 'function', name, description, strict: true,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });

export const ownerToolDefinitions = [
  tool('save_note', 'Save a private note only when the owner asks you to remember or record it. Never save credentials.', { text: string(2000) }),
  tool('find_notes', 'Find private notes previously saved by the owner.', { query: string(100) }),
  tool('create_task', 'Save an owner task. This is a task list, not a scheduled notification; do not promise a reminder.', { title: string(500) }),
  tool('list_tasks', 'List saved open owner tasks.', {}),
  tool('complete_task', 'Mark a saved task complete only at the owner request.', { id: { type: 'integer', minimum: 1 } })
];

export function createOwnerTools(db, ownerPhone) {
  db.exec(`CREATE TABLE IF NOT EXISTS owner_notes (
    id INTEGER PRIMARY KEY, owner_phone TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owner_tasks (
    id INTEGER PRIMARY KEY, owner_phone TEXT NOT NULL, title TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS tool_results (
    operation_key TEXT PRIMARY KEY, owner_phone TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);`);

  function execute(sender, messageKey, name, args = {}) {
    // Authorization is from the signed WhatsApp envelope, never the model or message text.
    if (!ownerPhone || sender !== ownerPhone) throw new Error('Owner authorization required');
    const definition = ownerToolDefinitions.find(t => t.name === name);
    if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid owner tool');
    const keys = Object.keys(definition.parameters.properties);
    if (Object.keys(args).some(k => !keys.includes(k)) || keys.some(k => !(k in args))) throw new Error('Invalid tool arguments');
    for (const key of keys) {
      const spec = definition.parameters.properties[key];
      if (spec.type === 'string' && (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > spec.maxLength)) throw new Error('Invalid tool arguments');
      if (spec.type === 'integer' && (!Number.isSafeInteger(args[key]) || args[key] < 1)) throw new Error('Invalid tool arguments');
    }
    if (name === 'save_note' && /\b(sk-(?:proj-)?[A-Za-z0-9_-]{12,}|EA[A-Za-z0-9]{40,}|password\s*[:=]|api[_ -]?key\s*[:=]|access[_ -]?token\s*[:=])/i.test(args.text)) {
      throw new Error('Do not store credentials in notes');
    }
    const canonical = JSON.stringify(Object.fromEntries(keys.sort().map(k => [k, args[k]])));
    const op = createHash('sha256').update(`${messageKey}:${name}:${canonical}`).digest('hex');
    const mutates = ['save_note', 'create_task', 'complete_task'].includes(name);
    const cached = mutates && db.prepare('SELECT result FROM tool_results WHERE operation_key=? AND owner_phone=?').get(op, ownerPhone);
    if (cached) return JSON.parse(cached.result);
    const now = new Date().toISOString();
    let result;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (name === 'save_note') {
        const row = db.prepare('INSERT INTO owner_notes(owner_phone,text,created_at) VALUES(?,?,?)').run(ownerPhone, args.text.trim(), now);
        result = { saved: true, note_id: Number(row.lastInsertRowid) };
      } else if (name === 'find_notes') {
        result = { notes: db.prepare('SELECT id,text FROM owner_notes WHERE owner_phone=? AND instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT 10').all(ownerPhone, args.query.trim()) };
      } else if (name === 'create_task') {
        const row = db.prepare('INSERT INTO owner_tasks(owner_phone,title,created_at) VALUES(?,?,?)').run(ownerPhone, args.title.trim(), now);
        result = { saved: true, task_id: Number(row.lastInsertRowid), title: args.title.trim(), notifications_scheduled: false };
      } else if (name === 'list_tasks') {
        result = { tasks: db.prepare("SELECT id,title FROM owner_tasks WHERE owner_phone=? AND state='open' ORDER BY id LIMIT 30").all(ownerPhone) };
      } else {
        const row = db.prepare("UPDATE owner_tasks SET state='completed',completed_at=? WHERE id=? AND owner_phone=? AND state='open'").run(now, args.id, ownerPhone);
        result = { completed: Boolean(row.changes), task_id: args.id };
      }
      if (mutates) db.prepare('INSERT INTO tool_results(operation_key,owner_phone,result,created_at) VALUES(?,?,?,?)').run(op, ownerPhone, JSON.stringify(result), now);
      db.exec('COMMIT');
      return result;
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  function command(sender, messageKey, text, capabilities) {
    if (sender !== ownerPhone || !ownerPhone) return null;
    const ar = /[\u0600-\u06ff]/u.test(text);
    const t = text.trim();
    if (/^\/(help|start)$/i.test(t)) return ar
      ? 'PillarSpec Jarvis — قناة كريم الخاصة.\n/remember نص — حفظ ملاحظة\n/notes كلمة — البحث في الملاحظات\n/task نص — حفظ مهمة\n/tasks — عرض المهام\n/done رقم — إكمال مهمة\n/status — حالة القدرات\nاطلب البحث أو التحليل بلغتك عند تفعيل AI. المهام المحفوظة لا تُنشئ إشعارات تلقائية.'
      : 'PillarSpec Jarvis — Karim’s private channel.\n/remember text — save a note\n/notes keyword — find notes\n/task text — save a task\n/tasks — list tasks\n/done id — complete a task\n/status — capabilities\nAsk for research or analysis in your language when AI is active. Saved tasks do not schedule notifications.';
    if (/^\/status$/i.test(t)) return `PillarSpec Jarvis\nAI: ${capabilities.ai ? 'enabled' : 'not configured'}\nResearch: ${capabilities.research ? 'enabled' : 'not configured'}\nPrivate notes/tasks: enabled\nEmail/calendar/account actions: not connected\nPrices: USD`;
    let name, args;
    if (/^\/remember\s+/i.test(t)) { name = 'save_note'; args = { text: t.replace(/^\/remember\s+/i, '') }; }
    else if (/^\/notes\s+/i.test(t)) { name = 'find_notes'; args = { query: t.replace(/^\/notes\s+/i, '') }; }
    else if (/^\/task\s+/i.test(t)) { name = 'create_task'; args = { title: t.replace(/^\/task\s+/i, '') }; }
    else if (/^\/tasks$/i.test(t)) { name = 'list_tasks'; args = {}; }
    else if (/^\/done\s+\d+$/i.test(t)) { name = 'complete_task'; args = { id: Number(t.replace(/^\/done\s+/i, '')) }; }
    if (!name) return null;
    try { return formatToolResult(execute(sender, messageKey, name, args), ar); }
    catch { return ar ? 'لم يتم تنفيذ الطلب. تحقق من الصيغة والطول، ولا تحفظ كلمات مرور أو مفاتيح دخول.' : 'The request was not executed. Check its format and length; do not save passwords or API keys.'; }
  }
  return { execute, command };
}

export function formatToolResult(result, ar = false) {
  if (result.note_id) return ar ? `تم حفظ الملاحظة #${result.note_id}.` : `Saved private note #${result.note_id}.`;
  if (result.notes) return result.notes.map(n => `#${n.id}: ${n.text}`).join('\n') || (ar ? 'لا توجد ملاحظات مطابقة.' : 'No matching notes.');
  if (result.tasks) return result.tasks.map(n => `#${n.id}: ${n.title}`).join('\n') || (ar ? 'لا توجد مهام مفتوحة.' : 'No open tasks.');
  if ('completed' in result) return result.completed ? (ar ? `اكتملت المهمة #${result.task_id}.` : `Completed task #${result.task_id}.`) : (ar ? 'المهمة غير موجودة أو مكتملة بالفعل.' : 'Task not found or already complete.');
  return ar ? `تم حفظ المهمة #${result.task_id}: ${result.title}\nلم يتم جدولة إشعار.` : `Saved task #${result.task_id}: ${result.title}\nNo notification was scheduled.`;
}
