/** Pure JavaScript SHA-256/PBKDF2 avoids fast, unsalted password storage. */
class PasswordCrypto {
  static bytes(text) { return Utilities.newBlob(String(text)).getBytes().map(value => value & 255); }
  static hex(bytes) { return bytes.map(value => ('0' + (value & 255).toString(16)).slice(-2)).join(''); }
  static sha256(bytes) {
    const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const message = bytes.slice(); const length = message.length * 8;
    message.push(128); while (message.length % 64 !== 56) message.push(0);
    const high = Math.floor(length / 4294967296), low = length >>> 0;
    [high, low].forEach(value => { for (let i = 3; i >= 0; i--) message.push((value >>> (i * 8)) & 255); });
    const rotate = (value, count) => (value >>> count) | (value << (32 - count));
    const words = new Array(64);
    for (let offset = 0; offset < message.length; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = (message[offset + i * 4] << 24) | (message[offset + i * 4 + 1] << 16) | (message[offset + i * 4 + 2] << 8) | message[offset + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const a = words[i - 15], b = words[i - 2];
        words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a,b,c,d,e,f,g,h] = state;
      for (let i = 0; i < 64; i++) {
        const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
        const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h=g; g=f; f=e; e=(d+first)|0; d=c; c=b; b=a; a=(first+second)|0;
      }
      [a,b,c,d,e,f,g,h].forEach((value, i) => { state[i] = (state[i] + value) | 0; });
    }
    const output = [];
    state.forEach(value => { for (let i = 3; i >= 0; i--) output.push((value >>> (8 * i)) & 255); });
    return output;
  }
  static hash(text) { return this.hex(this.sha256(this.bytes(text))); }
  static derive(password, salt, iterations) {
    let key = this.bytes(password);
    if (key.length > 64) key = this.sha256(key);
    while (key.length < 64) key.push(0);
    const inner = key.map(value => value ^ 0x36), outer = key.map(value => value ^ 0x5c);
    const hmac = data => this.sha256(outer.concat(this.sha256(inner.concat(data))));
    let previous = hmac(this.bytes(salt).concat([0, 0, 0, 1]));
    const output = previous.slice();
    for (let i = 1; i < iterations; i++) { previous = hmac(previous); for (let j = 0; j < 32; j++) output[j] ^= previous[j]; }
    return this.hex(output);
  }
  static equal(left, right) {
    let difference = String(left).length ^ String(right).length;
    for (let i = 0; i < Math.max(String(left).length, String(right).length); i++) difference |= (String(left).charCodeAt(i) || 0) ^ (String(right).charCodeAt(i) || 0);
    return difference === 0;
  }
  static password(value) {
    if (typeof value !== 'string' || value.length < 4 || value.length > 128) throw new AppError('VALIDATION', 'รหัสผ่านต้องยาว 4–128 ตัวอักษร');
    return value;
  }
  static credentials(password) {
    const salt = uuid_().replace(/-/g, '') + uuid_().replace(/-/g, '');
    return { passwordSalt: salt, passwordHash: this.derive(this.password(password), salt, APP_CONFIG.passwordIterations), passwordIterations: APP_CONFIG.passwordIterations };
  }
}

class Authorization {
  static admin(actor) { if (!actor || actor.role !== 'admin') throw new AppError('FORBIDDEN', 'เฉพาะผู้ดูแลระบบเท่านั้น'); }
  // Existing admin accounts are the legacy name for the single super administrator role.
  static superAdmin(actor) { if (!actor || !['super_admin','admin'].includes(actor.role)) throw new AppError('FORBIDDEN', 'เฉพาะ Super Admin เท่านั้น'); }
  static rooms(actor) {
    const classrooms = Database.repo('classrooms').all();
    if (actor.role === 'admin') return classrooms;
    let assigned = [];
    try { assigned = JSON.parse(actor.classroomIds || '[]'); } catch (error) { assigned = []; }
    return classrooms.filter(room => room.advisorId === actor.userId || assigned.includes(room.classroomId));
  }
  static classroom(actor, classroomId) {
    const room = this.rooms(actor).find(item => item.classroomId === classroomId);
    if (!room) throw new AppError('FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึงห้องเรียนนี้');
    return room;
  }
  static user(actor) {
    return { userId: actor.userId, username: actor.username, displayName: actor.displayName, role: actor.role, classroomIds: this.rooms(actor).map(room => room.classroomId), mustChangePassword: Validation.bool(actor.mustChangePassword), active: Validation.bool(actor.active) };
  }
  static editorOwner() {
    const active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
    if (!active || active !== effective) throw new AppError('FORBIDDEN', 'เรียกฟังก์ชันนี้จาก Apps Script Editor ด้วยบัญชีเจ้าของโครงการเท่านั้น');
  }
}

class AuthService {
  static login(payload, requestId) {
    const username = Validation.required(payload.username, 'ชื่อผู้ใช้', 100).toLowerCase();
    const password = String(payload.password || '');
    if (password.length > 128) throw new AppError('LOGIN_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    return withLock_(() => {
      const cache = CacheService.getScriptCache(), key = 'login:' + PasswordCrypto.hash(username), globalKey = 'login:global';
      const failures = Number(cache.get(key) || 0), globalFailures = Number(cache.get(globalKey) || 0);
      if (failures >= 8 || globalFailures >= 80) throw new AppError('RATE_LIMIT', 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที');
      const user = Database.repo('users').all().find(item => String(item.username).toLowerCase() === username);
      const hash = PasswordCrypto.derive(password, user ? user.passwordSalt : 'unknown-account-dummy-salt', user ? Number(user.passwordIterations) : APP_CONFIG.passwordIterations);
      if (!user || !Validation.bool(user.active) || !PasswordCrypto.equal(hash, user.passwordHash)) {
        cache.put(key, String(failures + 1), 900); cache.put(globalKey, String(globalFailures + 1), 900);
        AuditLog.write(null, 'login_failed', username, null, { username }, null, requestId);
        throw new AppError('LOGIN_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
      cache.remove(key);
      const token = uuid_().replace(/-/g, '') + uuid_().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + APP_CONFIG.sessionHours * 3600000).toISOString();
      Database.repo('sessions').append({ tokenHash: PasswordCrypto.hash(token), userId: user.userId, expiresAt, createdAt: nowIso_(), revokedAt: '' });
      AuditLog.write(user, 'login', user.userId, null, { expiresAt }, null, requestId);
      return { token, expiresAt, user: Authorization.user(user), mustChangePassword: Validation.bool(user.mustChangePassword) };
    });
  }
  static authenticate(token, allowPasswordChange) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw new AppError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const session = Database.repo('sessions').find('tokenHash', PasswordCrypto.hash(token));
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) throw new AppError('UNAUTHORIZED', 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const user = Database.repo('users').find('userId', session.userId);
    if (!user || !Validation.bool(user.active)) throw new AppError('UNAUTHORIZED', 'บัญชีนี้ไม่ได้เปิดใช้งาน');
    if (Validation.bool(user.mustChangePassword) && !allowPasswordChange) throw new AppError('PASSWORD_CHANGE_REQUIRED', 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน');
    return Object.assign({}, user, { _session: session });
  }
  static logout(actor, requestId) {
    return withLock_(() => { const session = actor._session; session.revokedAt = nowIso_(); Database.repo('sessions').update(session); AuditLog.write(actor, 'logout', actor.userId, null, null, null, requestId); return { loggedOut: true }; });
  }
  static changePassword(actor, payload, requestId) {
    const newPassword = PasswordCrypto.password(payload.newPassword);
    if (newPassword === payload.currentPassword) throw new AppError('VALIDATION', 'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม');
    return withLock_(() => {
      const repo = Database.repo('users'), user = repo.find('userId', actor.userId);
      if (!PasswordCrypto.equal(PasswordCrypto.derive(String(payload.currentPassword || ''), user.passwordSalt, Number(user.passwordIterations)), user.passwordHash)) throw new AppError('VALIDATION', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      Object.assign(user, PasswordCrypto.credentials(newPassword), { mustChangePassword: false, updatedAt: nowIso_() }); repo.update(user);
      this.revokeSessions(user.userId, actor._session.tokenHash);
      AuditLog.write(user, 'change_password', user.userId, null, { changed: true }, null, requestId);
      return { changed: true, user: Authorization.user(user) };
    });
  }
  static revokeSessions(userId, exceptHash) {
    const repo = Database.repo('sessions');
    repo.all().filter(session => session.userId === userId && session.tokenHash !== exceptHash && !session.revokedAt).forEach(session => { session.revokedAt = nowIso_(); repo.update(session); });
  }
}

class UserEmailService {
  static get(userId) {
    const row = Database.repo('user_emails').find('userId', userId);
    return row ? String(row.email || '') : '';
  }
  static save(userId, email, updatedBy) {
    const value = String(email || '').trim().toLowerCase();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AppError('VALIDATION', 'อีเมลไม่ถูกต้อง');
    const repo = Database.repo('user_emails'), existing = repo.find('userId', userId);
    if (!value) { if (existing) repo.removeRows([existing._row]); return; }
    repo.upsert('userId', { userId, email:value, updatedAt:nowIso_(), updatedBy:String(updatedBy || 'system') });
  }
}

class PasswordResetService {
  static request(payload, requestId) {
    const username = String(payload.username || '').trim().toLowerCase();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,100}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('VALIDATION', 'กรุณาระบุชื่อผู้ใช้และอีเมลให้ถูกต้อง');
    return withLock_(() => {
      const user = Database.repo('users').all().find(item => String(item.username).toLowerCase() === username && Validation.bool(item.active));
      const registered = user && UserEmailService.get(user.userId);
      if (user && registered && registered === email) {
        const token = uuid_().replace(/-/g,'') + uuid_().replace(/-/g,'');
        const resetRepo = Database.repo('password_resets');
        resetRepo.all().filter(row => row.userId === user.userId && !row.usedAt).forEach(row => { row.usedAt = nowIso_(); resetRepo.update(row); });
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        resetRepo.append({ resetId:uuid_(), userId:user.userId, tokenHash:PasswordCrypto.hash(token), expiresAt, usedAt:'', createdAt:nowIso_(), requestEmail:email });
        const resetUrl = APP_CONFIG.frontendUrl + '?reset=' + encodeURIComponent(token);
        MailApp.sendEmail({ to:email, subject:'รีเซ็ตรหัสผ่านระบบเช็คชื่อ โรงเรียนตากใบ', body:'มีคำขอรีเซ็ตรหัสผ่านบัญชี ' + user.username + '\n\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ 15 นาที):\n' + resetUrl + '\n\nหากเปิดลิงก์ไม่ได้ ใช้รหัสรีเซ็ตนี้แทน:\n' + token + '\n\nหากคุณไม่ได้เป็นผู้ขอ ให้เพิกเฉยต่ออีเมลนี้' });
        AuditLog.write(null, 'request_password_reset', user.userId, null, { emailSent:true }, null, requestId);
      }
      const matched = Boolean(user && registered && registered === email);
      return { requested:true, matched, message:matched ? 'พบข้อมูลบัญชี ระบบส่งรหัสรีเซ็ตไปยังอีเมลที่ลงทะเบียนไว้แล้ว' : 'ไม่พบชื่อผู้ใช้และอีเมลที่ตรงกัน กรุณาตรวจสอบข้อมูลอีกครั้ง' };
    });
  }
  static reset(payload, requestId) {
    const token = String(payload.token || '').trim(), newPassword = PasswordCrypto.password(String(payload.newPassword || ''));
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new AppError('VALIDATION', 'รหัสรีเซ็ตไม่ถูกต้องหรือหมดอายุ');
    return withLock_(() => {
      const resetRepo = Database.repo('password_resets'), row = resetRepo.all().find(item => item.tokenHash === PasswordCrypto.hash(token) && !item.usedAt && new Date(item.expiresAt).getTime() > Date.now());
      if (!row) throw new AppError('VALIDATION', 'รหัสรีเซ็ตไม่ถูกต้องหรือหมดอายุ');
      const userRepo = Database.repo('users'), user = userRepo.find('userId', row.userId);
      if (!user || !Validation.bool(user.active)) throw new AppError('VALIDATION', 'บัญชีนี้ไม่พร้อมใช้งาน');
      Object.assign(user, PasswordCrypto.credentials(newPassword), { mustChangePassword:false, updatedAt:nowIso_() }); userRepo.update(user);
      row.usedAt = nowIso_(); resetRepo.update(row); AuthService.revokeSessions(user.userId);
      AuditLog.write(user, 'reset_password_by_email', user.userId, null, { changed:true }, null, requestId);
      return { reset:true };
    });
  }
}
