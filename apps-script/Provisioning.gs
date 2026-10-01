class StaffProvisioning {
  static seed(rows, password, emailDomain) {
    Authorization.editorOwner();
    if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new AppError('VALIDATION', 'ข้อมูลบุคลากรไม่ถูกต้อง');
    const defaultPassword = PasswordCrypto.password(String(password || ''));
    const domain = String(emailDomain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new AppError('VALIDATION', 'โดเมนอีเมลไม่ถูกต้อง');
    return withLock_(() => {
      const userRepo = Database.repo('users'), emailRepo = Database.repo('user_emails');
      const existingUsers = userRepo.all(), existingByUsername = new Map(existingUsers.map(user => [String(user.username).toLowerCase(), user]));
      const sheet = Database.open().getSheetByName('staff_directory') || Database.open().insertSheet('staff_directory');
      const headers = ['staffId','name','position','subject','username','email','createdAt'];
      if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
      if (sheet.getLastRow() === 0) { sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1,1,1,headers.length).setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold'); }
      const currentStaff = sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();
      const staffRows = new Map(currentStaff.filter(row => String(row[0])).map(row => [String(row[0]), row]));
      let created = 0, updated = 0;
      rows.forEach(input => {
        const staffId = Validation.required(input.staffId, 'รหัสบุคลากร', 40).toLowerCase();
        const name = Validation.required(input.name, 'ชื่อบุคลากร', 250);
        const position = Validation.text(input.position, 250), subject = Validation.text(input.subject, 250);
        const username = staffId, email = username + '@' + domain, now = nowIso_();
        let user = existingByUsername.get(username);
        if (user) { Object.assign(user, { displayName:name, role:'advisor', active:true, updatedAt:now }); userRepo.update(user); updated++; }
        else { user = Object.assign({ userId:uuid_(), username, displayName:name, role:'advisor', classroomIds:'[]', active:true, mustChangePassword:true, createdAt:now, updatedAt:now }, PasswordCrypto.credentials(defaultPassword)); userRepo.append(user); existingByUsername.set(username,user); created++; }
        UserEmailService.save(user.userId, email, 'staff-provisioning');
        staffRows.set(staffId, [staffId,name,position,subject,username,email,now]);
      });
      const values = [...staffRows.values()];
      if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).clearContent();
      if (values.length) { if (sheet.getMaxRows() < values.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), values.length + 1 - sheet.getMaxRows()); sheet.getRange(2,1,values.length,headers.length).setValues(values); }
      sheet.autoResizeColumns(1,headers.length);
      AuditLog.write(null, 'provision_staff_accounts', 'staff_directory', null, { count:rows.length, created, updated }, null, '');
      return { created, updated, total:rows.length, emailDomain:domain };
    });
  }
}

function provisionStaffAccounts(rows, password, emailDomain) {
  return StaffProvisioning.seed(rows, password, emailDomain);
}
