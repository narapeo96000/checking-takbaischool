class SettingsService {
  static all() {
    const result = jsonClone_(DEFAULT_SETTINGS);
    Database.repo('settings').all().forEach(row => { if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, row.key)) { try { result[row.key] = JSON.parse(row.value); } catch (error) { result[row.key] = row.value; } } });
    return result;
  }
  static publicSettings() {
    const values = this.all(), result = {};
    ['schoolName','affiliation','address','email','website','logoUrl','director','deputyDirectors','reportTime','primaryColor','secondaryColor'].forEach(key => { result[key] = values[key]; });
    return result;
  }
  static get(actor) {
    Authorization.superAdmin(actor);
    const values = this.all(), properties = PropertiesService.getScriptProperties();
    values.lineConfigured = !!properties.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    values.telegramConfigured = !!properties.getProperty('TELEGRAM_BOT_TOKEN');
    values.chatbotConfigured = !!properties.getProperty('CHATBOT_TOKEN');
    return values;
  }
  static save(actor, payload, requestId) {
    Authorization.superAdmin(actor);
    return withLock_(() => {
      const before = this.all(), next = Object.assign({}, before);
      ['schoolName','affiliation','address','email','director','lineTargetId','telegramChatId'].forEach(key => { if (Object.prototype.hasOwnProperty.call(payload, key)) next[key] = Validation.text(payload[key], key === 'address' ? 1000 : 250); });
      if (!next.schoolName) throw new AppError('VALIDATION', 'กรุณาระบุชื่อโรงเรียน');
      if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new AppError('VALIDATION', 'อีเมลไม่ถูกต้อง');
      ['website','logoUrl','chatbotUrl'].forEach(key => { if (Object.prototype.hasOwnProperty.call(payload, key)) next[key] = Validation.url(payload[key]); });
      if (next.chatbotUrl) NotificationService.validateWebhook(next.chatbotUrl);
      ['primaryColor','secondaryColor'].forEach(key => { if (Object.prototype.hasOwnProperty.call(payload, key)) { if (!/^#[a-f0-9]{6}$/i.test(payload[key])) throw new AppError('VALIDATION', 'สีต้องอยู่ในรูปแบบ #RRGGBB'); next[key] = payload[key]; } });
      if (Object.prototype.hasOwnProperty.call(payload, 'reportTime')) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.reportTime)) throw new AppError('VALIDATION', 'เวลารายงานต้องอยู่ในรูปแบบ HH:mm'); next.reportTime = payload.reportTime; }
      if (Object.prototype.hasOwnProperty.call(payload, 'attendanceWeights')) {
        const input = payload.attendanceWeights;
        if (!input || typeof input !== 'object') throw new AppError('VALIDATION', 'กำหนดค่าน้ำหนักสถิติไม่ถูกต้อง');
        const weights = {};
        ['present','leave','late','absent'].forEach(key => {
          const value = Number(input[key]);
          if (!Number.isFinite(value) || value < 0 || value > 1) throw new AppError('VALIDATION', 'ค่าน้ำหนักสถิติต้องอยู่ระหว่าง 0 ถึง 1');
          weights[key] = Math.round(value * 100) / 100;
        });
        next.attendanceWeights = weights;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'deputyDirectors')) {
        if (!Array.isArray(payload.deputyDirectors) || payload.deputyDirectors.length > 3) throw new AppError('VALIDATION', 'ระบุรองผู้อำนวยการได้ไม่เกิน 3 คน');
        next.deputyDirectors = payload.deputyDirectors.map(name => Validation.text(name, 250)).filter(Boolean);
      }
      ['dailyReportEnabled','lineEnabled','telegramEnabled','chatbotEnabled'].forEach(key => { if (Object.prototype.hasOwnProperty.call(payload, key)) next[key] = Validation.bool(payload[key]); });
      const properties = PropertiesService.getScriptProperties(), pendingSecrets = {}, tokenFields = { lineToken: 'LINE_CHANNEL_ACCESS_TOKEN', telegramToken: 'TELEGRAM_BOT_TOKEN', chatbotToken: 'CHATBOT_TOKEN' };
      Object.keys(tokenFields).forEach(field => {
        const value = payload.tokens && Object.prototype.hasOwnProperty.call(payload.tokens, field) ? payload.tokens[field] : payload[field];
        // Blank inputs preserve a configured token. clearSecrets explicitly removes it.
        if (value != null && value !== '') { const token = Validation.text(value, 5000); if (/\s/.test(token)) throw new AppError('VALIDATION', 'TOKEN ต้องไม่มีช่องว่าง'); pendingSecrets[tokenFields[field]] = token; }
        if (Array.isArray(payload.clearSecrets) && payload.clearSecrets.includes(field)) pendingSecrets[tokenFields[field]] = '';
      });
      const has = property => Object.prototype.hasOwnProperty.call(pendingSecrets, property) ? !!pendingSecrets[property] : !!properties.getProperty(property);
      if (next.lineEnabled && (!has('LINE_CHANNEL_ACCESS_TOKEN') || !next.lineTargetId)) throw new AppError('VALIDATION', 'กรุณาตั้งค่า LINE TOKEN และรหัสผู้รับก่อนเปิดใช้งาน');
      if (next.telegramEnabled && (!has('TELEGRAM_BOT_TOKEN') || !next.telegramChatId)) throw new AppError('VALIDATION', 'กรุณาตั้งค่า Telegram TOKEN และ Chat ID ก่อนเปิดใช้งาน');
      if (next.chatbotEnabled && (!has('CHATBOT_TOKEN') || !next.chatbotUrl)) throw new AppError('VALIDATION', 'กรุณาตั้งค่า Chatbot TOKEN และ URL ก่อนเปิดใช้งาน');
      Object.keys(pendingSecrets).forEach(key => { if (pendingSecrets[key]) properties.setProperty(key, pendingSecrets[key]); else properties.deleteProperty(key); });
      const repo = Database.repo('settings');
      Object.keys(next).forEach(key => { repo.upsert('key', { key, value: JSON.stringify(next[key]), updatedAt: nowIso_(), updatedBy: actor.userId }); });
      AuditLog.write(actor, 'save_settings', 'settings', before, Object.assign({}, next, { secretFieldsUpdated: Object.keys(pendingSecrets).map(key => key) }), null, requestId);
      NotificationService.configureTrigger(next.dailyReportEnabled);
      return this.get(actor);
    });
  }
}

class AdminService {
  static classrooms(actor) {
    const users = Database.repo('users').all();
    return Authorization.rooms(actor).map(room => Object.assign(SheetRepository.clean(room), { active: Validation.bool(room.active), advisorName: (users.find(user => user.userId === room.advisorId) || {}).displayName || '' })).sort((a,b) => a.name.localeCompare(b.name, 'th', { numeric: true }));
  }
  static students(actor, payload) {
    const rooms = this.classrooms(actor), allowed = rooms.map(room => room.classroomId);
    if (payload.classroomId) Authorization.classroom(actor, payload.classroomId);
    if (payload.advisorId) allowed.splice(0, allowed.length, ...rooms.filter(room => room.advisorId === payload.advisorId).map(room => room.classroomId));
    const search = Validation.text(payload.search, 200).toLocaleLowerCase();
    return Database.repo('students').all().filter(student => allowed.includes(student.classroomId) && (!payload.classroomId || student.classroomId === payload.classroomId) && (!payload.studentId || String(student.studentId) === String(payload.studentId)) && (payload.includeInactive || Validation.bool(student.active)) && (!search || [student.studentId,student.prefix,student.firstName,student.lastName].join(' ').toLocaleLowerCase().includes(search))).map(student => {
      const room = rooms.find(item => item.classroomId === student.classroomId) || {};
      return Object.assign(SheetRepository.clean(student), { active: Validation.bool(student.active), fullName: [student.prefix,student.firstName,student.lastName].filter(Boolean).join(' '), classroomName: room.name || '', advisorId: room.advisorId || '', advisorName: room.advisorName || '' });
    }).sort((a,b) => a.classroomName.localeCompare(b.classroomName, 'th', { numeric: true }) || Number(a.number) - Number(b.number) || a.studentId.localeCompare(b.studentId));
  }
  static users(actor) {
    Authorization.admin(actor);
    return Database.repo('users').all().map(user => { const result = Authorization.user(user); result.email = UserEmailService.get(user.userId); result.createdAt = user.createdAt; return result; });
  }
  static saveUser(actor, payload, requestId) {
    Authorization.admin(actor);
    return withLock_(() => {
      const repo = Database.repo('users'), previous = payload.userId ? repo.find('userId', payload.userId) : null;
      if (payload.userId && !previous) throw new AppError('NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
      const username = Validation.required(payload.username, 'ชื่อผู้ใช้', 100).toLowerCase();
      if (!/^[a-z0-9_.-]{3,100}$/.test(username)) throw new AppError('VALIDATION', 'ชื่อผู้ใช้ใช้ภาษาอังกฤษ ตัวเลข _ . - อย่างน้อย 3 ตัว');
      if (repo.all().some(user => String(user.username).toLowerCase() === username && (!previous || user.userId !== previous.userId))) throw new AppError('CONFLICT', 'มีชื่อผู้ใช้นี้แล้ว');
      const role = payload.role || (previous && previous.role) || 'advisor';
      if (!['admin','advisor'].includes(role)) throw new AppError('VALIDATION', 'ประเภทผู้ใช้ไม่ถูกต้อง');
      const classrooms = payload.classroomIds == null ? (previous ? JSON.parse(previous.classroomIds || '[]') : []) : payload.classroomIds;
      if (!Array.isArray(classrooms) || classrooms.some(id => !Database.repo('classrooms').find('classroomId', id))) throw new AppError('VALIDATION', 'รายชื่อห้องเรียนไม่ถูกต้อง');
      const user = Object.assign({}, previous || {}, { userId: previous ? previous.userId : uuid_(), username, displayName: Validation.required(payload.displayName, 'ชื่อผู้ใช้ที่แสดง', 250), role, classroomIds: JSON.stringify([...new Set(classrooms)]), active: Validation.bool(payload.active, previous ? Validation.bool(previous.active) : true), createdAt: previous ? previous.createdAt : nowIso_(), updatedAt: nowIso_() });
      if (!previous || payload.password) Object.assign(user, PasswordCrypto.credentials(payload.password), { mustChangePassword: true });
      if (previous && previous.role === 'admin' && Validation.bool(previous.active) && (user.role !== 'admin' || !user.active) && repo.all().filter(item => item.role === 'admin' && Validation.bool(item.active)).length <= 1) throw new AppError('VALIDATION', 'ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อยหนึ่งคน');
      if (previous) { repo.update(user); AuthService.revokeSessions(user.userId); } else repo.append(user);
      if (Object.prototype.hasOwnProperty.call(payload, 'email')) UserEmailService.save(user.userId, payload.email, actor.userId);
      AuditLog.write(actor, 'save_user', user.userId, previous ? Authorization.user(previous) : null, Authorization.user(user), null, requestId);
      const result = Authorization.user(user); result.email = UserEmailService.get(user.userId); return result;
    });
  }
  static saveStudent(actor, payload, requestId) {
    Authorization.admin(actor);
    return withLock_(() => {
      const repo = Database.repo('students'), studentId = Validation.id(payload.studentId, 'เลขประจำตัวนักเรียน'), previous = repo.find('studentId', studentId);
      const classroomId = Validation.id(payload.classroomId, 'ห้องเรียน');
      if (!Database.repo('classrooms').find('classroomId', classroomId)) throw new AppError('VALIDATION', 'ไม่พบห้องเรียน');
      const number = Number(payload.number || 0); if (!Number.isInteger(number) || number < 0 || number > 999) throw new AppError('VALIDATION', 'เลขที่ไม่ถูกต้อง');
      const student = Object.assign({}, previous || {}, { studentId, prefix: Validation.text(payload.prefix, 30), firstName: Validation.required(payload.firstName, 'ชื่อนักเรียน', 200), lastName: Validation.required(payload.lastName, 'นามสกุลนักเรียน', 200), classroomId, number, active: Validation.bool(payload.active, previous ? Validation.bool(previous.active) : true), createdAt: previous ? previous.createdAt : nowIso_(), updatedAt: nowIso_() });
      if (previous) repo.update(student); else repo.append(student);
      AuditLog.write(actor, 'save_student', studentId, SheetRepository.clean(previous), SheetRepository.clean(student), null, requestId);
      return SheetRepository.clean(student);
    });
  }
  static importStudents(actor, payload, requestId) {
    Authorization.admin(actor);
    return withLock_(() => {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length || rows.length > 1000) throw new AppError('VALIDATION', 'ไฟล์ต้องมีข้อมูลนักเรียน 1–1,000 รายการ');
      const repo = Database.repo('students'), classrooms = Database.repo('classrooms').all();
      const existing = new Set(repo.all().map(item => String(item.studentId)));
      const incoming = new Set(), prepared = [], duplicates = [];
      rows.forEach((row, index) => {
        const line = index + 2, studentId = Validation.id(row.studentId, `เลขประจำตัวแถว ${line}`);
        if (incoming.has(studentId) || existing.has(studentId)) duplicates.push(studentId);
        incoming.add(studentId);
        const classroomId = Validation.id(row.classroomId, `ห้องเรียนแถว ${line}`);
        if (!classrooms.some(item => item.classroomId === classroomId)) throw new AppError('VALIDATION', `ไม่พบห้องเรียน ${classroomId} ที่แถว ${line}`);
        const number = Number(row.number || 0);
        if (!Number.isInteger(number) || number < 0 || number > 999) throw new AppError('VALIDATION', `เลขที่ไม่ถูกต้องที่แถว ${line}`);
        prepared.push({ studentId, prefix: Validation.text(row.prefix, 30), firstName: Validation.required(row.firstName, `ชื่อนักเรียนแถว ${line}`, 200), lastName: Validation.required(row.lastName, `นามสกุลนักเรียนแถว ${line}`, 200), classroomId, number, active: row.active === false || String(row.active).toLowerCase() === 'false' ? false : true, createdAt: nowIso_(), updatedAt: nowIso_() });
      });
      if (duplicates.length) throw new AppError('CONFLICT', `พบเลขประจำตัวซ้ำ: ${[...new Set(duplicates)].slice(0, 20).join(', ')}`);
      repo.appendMany(prepared);
      AuditLog.write(actor, 'import_students', requestId, null, { count: prepared.length, studentIds: prepared.map(item => item.studentId) }, null, requestId);
      return { imported: prepared.length, skipped: 0 };
    });
  }
  static saveClassroom(actor, payload, requestId) {
    Authorization.admin(actor);
    return withLock_(() => {
      const repo = Database.repo('classrooms'), classroomId = Validation.id(payload.classroomId, 'รหัสห้องเรียน'), previous = repo.find('classroomId', classroomId);
      const advisorId = Validation.text(payload.advisorId, 80);
      if (advisorId) { const advisor = Database.repo('users').find('userId', advisorId); if (!advisor || !Validation.bool(advisor.active)) throw new AppError('VALIDATION', 'ไม่พบครูที่ปรึกษาที่เปิดใช้งาน'); }
      const room = Object.assign({}, previous || {}, { classroomId, name: Validation.required(payload.name, 'ชื่อห้องเรียน', 100), level: Validation.text(payload.level, 100), advisorId, active: Validation.bool(payload.active, previous ? Validation.bool(previous.active) : true), createdAt: previous ? previous.createdAt : nowIso_(), updatedAt: nowIso_() });
      if (previous) repo.update(room); else repo.append(room);
      AuditLog.write(actor, 'save_classroom', classroomId, SheetRepository.clean(previous), SheetRepository.clean(room), null, requestId);
      return SheetRepository.clean(room);
    });
  }
  static logs(actor, payload) {
    Authorization.admin(actor);
    const dateFrom = payload.dateFrom ? Validation.date(payload.dateFrom) : '', dateTo = payload.dateTo ? Validation.date(payload.dateTo) : '', search = Validation.text(payload.search, 200).toLowerCase();
    const limit = Math.min(1000, Math.max(1, Number(payload.limit) || 200));
    return Database.repo('logs').all().filter(log => (!dateFrom || bangkokDate_(log.timestamp) >= dateFrom) && (!dateTo || bangkokDate_(log.timestamp) <= dateTo) && (!payload.action || log.action === payload.action) && (!search || [log.actorName,log.actorId,log.entityId,log.action].join(' ').toLowerCase().includes(search))).reverse().slice(0, limit).map(log => {
      const result = SheetRepository.clean(log);
      ['beforeJson','afterJson','locationJson'].forEach(key => { try { result[key.replace('Json','')] = JSON.parse(log[key]); } catch (error) { result[key.replace('Json','')] = null; } delete result[key]; });
      return result;
    });
  }
}
