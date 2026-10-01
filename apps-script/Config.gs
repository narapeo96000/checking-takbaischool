/** Server configuration. Notification credentials belong in Script Properties only. */
const APP_CONFIG = Object.freeze({
  version: '1.0.0',
  spreadsheetId: '1nqfPAnIifkQV3NrD045__PNK7qe3n-cxBcdeqvfBwUw',
  reportFolderId: '1TL_yuWS76ri3H6xcrscIA_jQbGQTx63X',
  timezone: 'Asia/Bangkok',
  allowedOrigins: ['https://narapeo96000.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173'],
  sessionHours: 12,
  passwordIterations: 120000,
  maxReportDays: 366,
  maxRequestCharacters: 400000,
  statuses: ['present', 'absent', 'late', 'leave']
});

const SHEET_SCHEMAS = Object.freeze({
  students: ['studentId', 'prefix', 'firstName', 'lastName', 'classroomId', 'number', 'active', 'createdAt', 'updatedAt'],
  classrooms: ['classroomId', 'name', 'level', 'advisorId', 'active', 'createdAt', 'updatedAt'],
  users: ['userId', 'username', 'displayName', 'role', 'classroomIds', 'active', 'mustChangePassword', 'passwordSalt', 'passwordHash', 'passwordIterations', 'createdAt', 'updatedAt'],
  attendance: ['attendanceId', 'date', 'classroomId', 'studentId', 'status', 'reason', 'latitude', 'longitude', 'accuracy', 'capturedAt', 'locationError', 'updatedBy', 'updatedAt'],
  attendance_batches: ['batchId', 'date', 'classroomId', 'revision', 'updatedAt', 'updatedBy'],
  settings: ['key', 'value', 'updatedAt', 'updatedBy'],
  logs: ['logId', 'timestamp', 'actorId', 'actorName', 'action', 'entityId', 'beforeJson', 'afterJson', 'locationJson', 'requestId'],
  sessions: ['tokenHash', 'userId', 'expiresAt', 'createdAt', 'revokedAt'],
  mutations: ['mutationId', 'userId', 'action', 'payloadHash', 'resultJson', 'createdAt'],
  user_emails: ['userId', 'email', 'updatedAt', 'updatedBy'],
  password_resets: ['resetId', 'userId', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt', 'requestEmail']
});

const DEFAULT_SETTINGS = Object.freeze({
  schoolName: 'โรงเรียนตากใบ', affiliation: '', address: '', email: '', website: '',
  logoUrl: '', director: '', deputyDirectors: [], reportTime: '08:10',
  primaryColor: '#b91c1c', secondaryColor: '#2563eb',
  dailyReportEnabled: false, lineEnabled: false, lineTargetId: '',
  telegramEnabled: false, telegramChatId: '', chatbotEnabled: false, chatbotUrl: ''
});

class AppError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

class Validation {
  static required(value, label, max) {
    const result = String(value == null ? '' : value).trim();
    if (!result || result.length > (max || 200)) throw new AppError('VALIDATION', 'กรุณาระบุ' + label + 'ให้ถูกต้อง');
    return result;
  }
  static text(value, max) {
    const result = String(value == null ? '' : value).trim();
    if (result.length > (max || 500)) throw new AppError('VALIDATION', 'ข้อความยาวเกินกำหนด');
    return result;
  }
  static id(value, label) {
    const result = this.required(value, label || 'รหัส', 80);
    if (!/^[A-Za-z0-9_./-]+$/.test(result)) throw new AppError('VALIDATION', 'รหัสต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือ _ . / -');
    return result;
  }
  static date(value) {
    const result = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new AppError('VALIDATION', 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
    const date = new Date(result + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new AppError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    return result;
  }
  static bool(value, fallback) {
    if (value == null || value === '') return !!fallback;
    return value === true || value === 'true' || value === 1 || value === '1';
  }
  static url(value, label) {
    const result = this.text(value, 2048);
    if (result && !/^https:\/\/[^\s@/?#]+(?:[/?#][^\s]*)?$/i.test(result)) throw new AppError('VALIDATION', (label || 'ลิงก์') + 'ต้องใช้ HTTPS');
    return result;
  }
  static location(payload) {
    if (!payload.location) return { location: null, locationError: this.text(payload.locationError || 'ไม่ได้รับพิกัดจากอุปกรณ์', 300) };
    const point = payload.location;
    const latitude = Number(point.latitude), longitude = Number(point.longitude), accuracy = Number(point.accuracy);
    if (point.latitude == null || point.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) throw new AppError('VALIDATION', 'พิกัดไม่ถูกต้อง');
    const captured = new Date(point.capturedAt || new Date().toISOString());
    if (!Number.isFinite(captured.getTime()) || Math.abs(Date.now() - captured.getTime()) > 24 * 3600000) throw new AppError('VALIDATION', 'เวลาบันทึกพิกัดต้องอยู่ภายใน 24 ชั่วโมง');
    return { location: { latitude, longitude, accuracy, capturedAt: captured.toISOString() }, locationError: '' };
  }
}

function nowIso_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'yyyy-MM-dd'); }
function bangkokDate_(value) { return Utilities.formatDate(new Date(value), APP_CONFIG.timezone, 'yyyy-MM-dd'); }
function uuid_() { return Utilities.getUuid(); }
function jsonClone_(value) { return JSON.parse(JSON.stringify(value)); }
function withLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new AppError('BUSY', 'ระบบกำลังบันทึกข้อมูล กรุณาลองใหม่');
  try { return callback(); } finally { lock.releaseLock(); }
}
