/** Only dispatch exposes data; anonymous callers can read branding and log in. */
function dispatch(request) {
  let action = '', requestId = '';
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || JSON.stringify(request).length > APP_CONFIG.maxRequestCharacters) throw new AppError('VALIDATION','คำขอไม่ถูกต้องหรือมีขนาดใหญ่เกินกำหนด');
    action = Validation.text(request.action,80); requestId = Validation.text(request.requestId,100);
    const payload = request.payload || {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('VALIDATION','ข้อมูลคำขอไม่ถูกต้อง');
    // Re-check on every request even if an owner re-shares an initialized Sheet.
    Database.assertPrivate();
    if (action === 'login') return { ok:true,data:AuthService.login(payload,requestId) };
    if (action === 'bootstrap') {
      const data = { settings:SettingsService.publicSettings(),today:today_(),statuses:APP_CONFIG.statuses,version:APP_CONFIG.version };
      if (request.token) { const actor = AuthService.authenticate(request.token,true); data.user = Authorization.user(actor); data.classrooms = AdminService.classrooms(actor); }
      return { ok:true,data };
    }
    const actor = AuthService.authenticate(request.token,['changePassword','logout'].includes(action));
    let result;
    switch (action) {
      case 'logout': result = AuthService.logout(actor,requestId); break;
      case 'changePassword': result = AuthService.changePassword(actor,payload,requestId); break;
      case 'listStudents': result = AdminService.students(actor,payload); break;
      case 'listClassrooms': result = AdminService.classrooms(actor); break;
      case 'getAttendance': result = AttendanceService.get(actor,payload); break;
      case 'saveAttendance': result = AttendanceService.mutate(actor,payload,requestId,false); break;
      case 'clearAttendance': result = AttendanceService.mutate(actor,payload,requestId,true); break;
      case 'dashboard': result = ReportService.statistics(actor,Object.assign({ date:today_() },payload)); break;
      case 'statistics': result = ReportService.statistics(actor,payload); break;
      case 'getSettings': result = SettingsService.get(actor); break;
      case 'saveSettings': result = SettingsService.save(actor,payload,requestId); break;
      case 'listUsers': result = AdminService.users(actor); break;
      case 'saveUser': result = AdminService.saveUser(actor,payload,requestId); break;
      case 'saveStudent': result = AdminService.saveStudent(actor,payload,requestId); break;
      case 'saveClassroom': result = AdminService.saveClassroom(actor,payload,requestId); break;
      case 'exportPdf': result = ReportService.exportPdf(actor,payload,requestId); break;
      case 'getLogs': result = AdminService.logs(actor,payload); break;
      default: throw new AppError('UNKNOWN_ACTION','ไม่พบคำสั่งที่เรียกใช้');
    }
    return { ok:true,data:result };
  } catch (error) {
    if (error instanceof AppError) return { ok:false,error:{ code:error.code,message:error.message,details:error.details } };
    const reference = uuid_();
    console.error('Server error',reference,action,requestId);
    return { ok:false,error:{ code:'INTERNAL',message:'ระบบขัดข้อง กรุณาลองใหม่หรือติดต่อผู้ดูแล รหัสอ้างอิง ' + reference } };
  }
}

function doGet(event) {
  const parameters = (event && event.parameter) || {}, hostOrigin = parameters.hostOrigin || parameters.origin || '', channel = parameters.channel || '';
  if (!APP_CONFIG.allowedOrigins.includes(hostOrigin) || !/^[a-zA-Z0-9_-]{16,120}$/.test(channel)) return HtmlService.createHtmlOutput('<!doctype html><html lang="th"><meta charset="utf-8"><title>ระบบเช็คชื่อ</title><body><p>กรุณาเข้าใช้งานผ่านเว็บไซต์โรงเรียน</p></body></html>');
  const template = HtmlService.createTemplateFromFile('Bridge');
  template.configJson = JSON.stringify({ hostOrigin,channel });
  return template.evaluate().setTitle('Attendance connection').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Run once in Apps Script Editor. Existing sheets and people are preserved. */
function setupSystem() {
  Authorization.editorOwner();
  return withLock_(() => {
    Database.initialize();
    const repo = Database.repo('users');
    let created = false;
    if (!repo.all().some(user => user.role === 'admin' && Validation.bool(user.active))) {
      const password = uuid_().replace(/-/g,'') + 'Aa!';
      const actor = Object.assign({ userId:uuid_(),username:'admin',displayName:'ผู้ดูแลระบบ',role:'admin',classroomIds:'[]',active:true,mustChangePassword:true,createdAt:nowIso_(),updatedAt:nowIso_() },PasswordCrypto.credentials(password));
      // A pre-existing disabled admin username must not be silently overwritten.
      if (repo.all().some(user => user.username === 'admin')) actor.username = 'admin.' + uuid_().slice(0,8);
      repo.append(actor); created = true;
      console.log('บัญชีผู้ดูแลชั่วคราว: ' + actor.username + '\nรหัสผ่านชั่วคราว: ' + password + '\nต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก');
      AuditLog.write(actor,'setup_admin',actor.userId,null,{ username:actor.username,mustChangePassword:true },null,'');
    }
    AuditLog.write(null,'setup_system','database',null,{ sheets:Object.keys(SHEET_SCHEMAS),createdAdmin:created },null,'');
    console.log('สร้างและตรวจสอบชีตเสร็จแล้ว: ' + Object.keys(SHEET_SCHEMAS).join(', '));
    return { initialized:true,sheets:Object.keys(SHEET_SCHEMAS),createdAdmin:created };
  });
}

/** Owner-only recovery; optional username defaults to admin. No password returned. */
function resetAdminPassword(username) {
  Authorization.editorOwner();
  return withLock_(() => {
    Database.assertPrivate();
    const repo = Database.repo('users'), user = repo.all().find(item => item.username === String(username || 'admin').toLowerCase() && item.role === 'admin');
    if (!user) throw new AppError('NOT_FOUND','ไม่พบบัญชีผู้ดูแลระบบ');
    const password = uuid_().replace(/-/g,'') + 'Aa!';
    Object.assign(user,PasswordCrypto.credentials(password),{ mustChangePassword:true,active:true,updatedAt:nowIso_() }); repo.update(user);
    AuthService.revokeSessions(user.userId);
    AuditLog.write(null,'reset_admin_password',user.userId,null,{ username:user.username,forcedPasswordChange:true },null,'');
    console.log('บัญชี: ' + user.username + '\nรหัสผ่านชั่วคราว: ' + password);
    return { reset:true };
  });
}
