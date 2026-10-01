/** Header-based repositories make the spreadsheet schema explicit and reviewable. */
class SheetRepository {
  constructor(name, spreadsheet) {
    this.name = name;
    this.columns = SHEET_SCHEMAS[name];
    this.sheet = (spreadsheet || Database.open()).getSheetByName(name);
    if (!this.sheet) throw new AppError('NOT_INITIALIZED', 'ยังไม่ได้สร้างชีต กรุณาเรียก setupSystem ใน Apps Script');
    this.assertSchema();
  }
  assertSchema() {
    const actual = this.sheet.getRange(1, 1, 1, this.columns.length).getValues()[0];
    if (this.columns.some((column, i) => actual[i] !== column)) throw new AppError('SCHEMA', 'หัวตารางชีต ' + this.name + ' ไม่ตรงกับระบบ กรุณาตรวจสอบก่อนใช้งาน');
  }
  all() {
    if (this.sheet.getLastRow() < 2) return [];
    return this.sheet.getRange(2, 1, this.sheet.getLastRow() - 1, this.columns.length).getValues().map((row, i) => {
      const item = { _row: i + 2 };
      this.columns.forEach((column, j) => { item[column] = row[j] instanceof Date ? row[j].toISOString() : row[j]; });
      return item;
    }).filter(item => String(item[this.columns[0]]) !== '');
  }
  find(key, value) { return this.all().find(item => String(item[key]) === String(value)) || null; }
  encode(item) {
    return this.columns.map(key => {
      const value = item[key] == null ? '' : item[key];
      if (typeof value === 'object') return JSON.stringify(value);
      // Prevent formulas when user-supplied text is written to Google Sheets.
      return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;
    });
  }
  ensureRows(required) {
    const current = this.sheet.getMaxRows();
    if (required > current) {
      const extra = Math.max(500, required - current);
      this.sheet.insertRowsAfter(current, extra);
      this.sheet.getRange(current + 1, 1, extra, this.columns.length).setNumberFormat('@');
    }
  }
  append(item) {
    const row = this.sheet.getLastRow() + 1;
    this.ensureRows(row);
    this.sheet.getRange(row, 1, 1, this.columns.length).setValues([this.encode(item)]);
    return Object.assign({}, item, { _row: row });
  }
  appendMany(items) {
    if (!items.length) return;
    this.ensureRows(this.sheet.getLastRow() + items.length);
    this.sheet.getRange(this.sheet.getLastRow() + 1, 1, items.length, this.columns.length).setValues(items.map(item => this.encode(item)));
  }
  update(item) {
    if (!item._row) throw new AppError('INTERNAL', 'ไม่พบแถวสำหรับบันทึก');
    this.sheet.getRange(item._row, 1, 1, this.columns.length).setValues([this.encode(item)]);
    return item;
  }
  upsert(key, item) {
    const existing = this.find(key, item[key]);
    return existing ? this.update(Object.assign({}, existing, item)) : this.append(item);
  }
  removeRows(rows) { rows.slice().sort((a, b) => b - a).forEach(row => this.sheet.deleteRow(row)); }
  static clean(item) { if (!item) return null; const result = Object.assign({}, item); delete result._row; return result; }
}

class Database {
  static assertPrivate() {
    // Student records, password hashes and sessions must never be placed in a
    // link-public or organization-public database. Named school members may
    // retain explicit access; this check never changes the user's permissions.
    const access = DriveApp.getFileById(APP_CONFIG.spreadsheetId).getSharingAccess();
    const optIn = PropertiesService.getScriptProperties().getProperty(APP_CONFIG.publicDatabaseOptInProperty) === 'true';
    if (access !== DriveApp.Access.PRIVATE && !optIn) throw new AppError('PRIVATE_DATABASE_REQUIRED', 'กรุณาตั้งค่าการแชร์ Google Sheet ฐานข้อมูลเป็น “จำกัด” หรือยืนยันการใช้ฐานข้อมูลสาธารณะด้วย Script Property ALLOW_PUBLIC_DATABASE=true ก่อนใช้งาน');
    return true;
  }
  static open() {
    if (!this.instance) { this.assertPrivate(); this.instance = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId); }
    return this.instance;
  }
  static repo(name) { return new SheetRepository(name, this.open()); }
  static initialize() {
    this.assertPrivate();
    const spreadsheet = this.open();
    spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.timezone);
    Object.keys(SHEET_SCHEMAS).forEach(name => {
      const columns = SHEET_SCHEMAS[name];
      let sheet = spreadsheet.getSheetByName(name);
      if (!sheet) sheet = spreadsheet.insertSheet(name);
      if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
      if (sheet.getLastRow() > 0) {
        const actual = sheet.getRange(1, 1, 1, columns.length).getValues()[0];
        if (columns.some((column, i) => column !== actual[i])) throw new AppError('SCHEMA', 'ชีต ' + name + ' มีข้อมูลเดิมและหัวตารางไม่ตรง ระบบจะไม่เขียนทับ');
      } else sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, columns.length).setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold');
      // IDs, dates and user input remain text (preserves leading zeros in school IDs).
      sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), columns.length).setNumberFormat('@');
      sheet.autoResizeColumns(1, columns.length);
    });
    const settings = this.repo('settings');
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (!settings.find('key', key)) settings.append({ key, value: JSON.stringify(DEFAULT_SETTINGS[key]), updatedAt: nowIso_(), updatedBy: 'setup' });
    });
  }
}

class AuditLog {
  static write(actor, action, entityId, before, after, location, requestId) {
    Database.repo('logs').append({ logId: uuid_(), timestamp: nowIso_(), actorId: actor ? actor.userId : 'system', actorName: actor ? actor.displayName : 'ระบบ', action, entityId: String(entityId || ''), beforeJson: JSON.stringify(before == null ? null : before), afterJson: JSON.stringify(after == null ? null : after), locationJson: JSON.stringify(location || null), requestId: requestId || '' });
  }
}
