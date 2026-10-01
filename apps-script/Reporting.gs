class ReportService {
  static range(payload) {
    let from, to;
    if (payload.date) from = to = Validation.date(payload.date);
    else if (payload.month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month)) throw new AppError('VALIDATION', 'เดือนต้องอยู่ในรูปแบบ YYYY-MM');
      from = payload.month + '-01';
      const parts = payload.month.split('-').map(Number);
      to = new Date(Date.UTC(parts[0], parts[1], 0)).toISOString().slice(0,10);
    } else { from = Validation.date(payload.dateFrom || today_()); to = Validation.date(payload.dateTo || from); }
    const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    if (days < 1 || days > APP_CONFIG.maxReportDays) throw new AppError('VALIDATION', 'เลือกช่วงวันได้ไม่เกิน ' + APP_CONFIG.maxReportDays + ' วัน');
    // A future day is not an attendance opportunity.
    return { dateFrom: from, dateTo: to < today_() ? to : today_(), requestedDateTo: to };
  }
  static statistics(actor, payload) {
    const range = this.range(payload), rooms = AdminService.classrooms(actor);
    if (payload.classroomId) Authorization.classroom(actor, payload.classroomId);
    const selectedRooms = rooms.filter(room => (!payload.classroomId || room.classroomId === payload.classroomId) && (!payload.advisorId || room.advisorId === payload.advisorId));
    const roomIds = selectedRooms.map(room => room.classroomId), students = Database.repo('students').all(), people = Object.fromEntries(students.map(student => [student.studentId, student]));
    const users = Object.fromEntries(Database.repo('users').all().map(user => [user.userId,user.displayName]));
    const search = Validation.text(payload.search, 200).toLocaleLowerCase();
    if (payload.studentId) Validation.id(payload.studentId, 'เลขประจำตัวนักเรียน');
    const matches = student => (!payload.studentId || String(student.studentId) === String(payload.studentId)) && (!search || [student.studentId,student.prefix,student.firstName,student.lastName].join(' ').toLocaleLowerCase().includes(search));
    const selectedStudents = students.filter(student => roomIds.includes(student.classroomId) && Validation.bool(student.active) && matches(student));
    const scopedRaw = Database.repo('attendance').all().filter(record => roomIds.includes(record.classroomId) && record.date >= range.dateFrom && record.date <= range.dateTo);
    const raw = scopedRaw.filter(record => matches(people[record.studentId] || { studentId: record.studentId }));
    const records = raw.map(record => {
      const student = people[record.studentId] || {}, room = selectedRooms.find(item => item.classroomId === record.classroomId) || {};
      return Object.assign(SheetRepository.clean(record), { fullName: [student.prefix,student.firstName,student.lastName].filter(Boolean).join(' ') || record.studentId, number: student.number || '', classroomName: room.name || record.classroomId, advisorId: room.advisorId || '', advisorName: room.advisorName || '', updatedByName: users[record.updatedBy] || '', locationRecorded: record.latitude !== '' && record.longitude !== '' });
    }).sort((a,b) => b.date.localeCompare(a.date) || a.classroomName.localeCompare(b.classroomName, 'th', { numeric: true }) || Number(a.number) - Number(b.number));
    const recordedDates = new Set(scopedRaw.map(record => record.date));
    Database.repo('attendance_batches').all().filter(batch => roomIds.includes(batch.classroomId) && batch.date >= range.dateFrom && batch.date <= range.dateTo).forEach(batch => recordedDates.add(batch.date));
    // Monthly/range reports use recorded days, never assume weekends/holidays
    // are school days. A single-day report still shows the unmarked roster.
    const singleDay = !!payload.date || range.dateFrom === range.requestedDateTo;
    const dates = singleDay && range.dateFrom <= range.dateTo ? [range.dateFrom] : [...recordedDates].sort();
    const weights = SettingsService.all().attendanceWeights;
    const daily = [], byClassroom = selectedRooms.map(room => Object.assign({ classroomId: room.classroomId, classroomName: room.name, advisorId: room.advisorId, advisorName: room.advisorName }, AttendanceService.summary([],0,weights)));
    const summary = AttendanceService.summary([],0,weights);
    dates.forEach(date => {
      const dailySummary = AttendanceService.summary([],0,weights);
      selectedRooms.forEach((room,i) => {
        const dayRecords = records.filter(record => record.date === date && record.classroomId === room.classroomId);
        const ids = new Set(selectedStudents.filter(student => student.classroomId === room.classroomId && (!student.createdAt || bangkokDate_(student.createdAt) <= date)).map(student => student.studentId));
        dayRecords.forEach(record => ids.add(record.studentId));
        const count = AttendanceService.summary(dayRecords, ids.size, weights);
        ['present','absent','late','leave','unmarked','total'].forEach(key => { dailySummary[key] += count[key]; byClassroom[i][key] += count[key]; summary[key] += count[key]; });
      });
      dailySummary.rate = dailySummary.total ? Math.round((dailySummary.present * weights.present + dailySummary.leave * weights.leave + dailySummary.late * weights.late + dailySummary.absent * weights.absent) / dailySummary.total * 10000) / 100 : 0;
      daily.push(Object.assign({ date },dailySummary));
    });
    summary.rate = summary.total ? Math.round((summary.present * weights.present + summary.leave * weights.leave + summary.late * weights.late + summary.absent * weights.absent) / summary.total * 10000) / 100 : 0;
    summary.dateCount = dates.length;
    byClassroom.forEach(row => { row.rate = row.total ? Math.round((row.present * weights.present + row.leave * weights.leave + row.late * weights.late + row.absent * weights.absent) / row.total * 10000) / 100 : 0; });
    return { summary, daily, byClassroom, records, classrooms: selectedRooms, range, studentCount: selectedStudents.length, attendanceWeights: weights, attendanceRateDefinition: `(มา × ${weights.present}) + (ลา × ${weights.leave}) + (สาย × ${weights.late}) + (ขาด × ${weights.absent}) หารด้วยจำนวนรายการที่ควรเช็คชื่อ × 100`, denominatorNote: (singleDay ? 'รายวันใช้รายชื่อนักเรียนที่ควรเช็คชื่อ' : 'เฉพาะวันที่มีการบันทึกเช็คชื่อ ไม่ใช่ปฏิทินวันเรียน') + '; ใช้รายชื่อนักเรียนปัจจุบันที่เปิดใช้งานและสร้างแล้ว ณ วันนั้น รวมรายการเช็คชื่อย้อนหลังที่มีอยู่' };
  }
  static exportPdf(actor, payload, requestId) {
    const report = this.statistics(actor,payload), settings = SettingsService.publicSettings();
    if (report.records.length > 5000) throw new AppError('REPORT_TOO_LARGE', 'ข้อมูลเกิน 5,000 รายการ กรุณาลดช่วงวันหรือเลือกห้องเรียน');
    const filename = 'รายงานการมาเรียน_' + report.range.dateFrom + '_' + report.range.dateTo + '.pdf';
    let documentFile;
    try {
      const document = DocumentApp.create('Attendance report ' + uuid_());
      documentFile = DriveApp.getFileById(document.getId());
      const body = document.getBody();
      body.setAttributes({ [DocumentApp.Attribute.FONT_FAMILY]: 'Sarabun', [DocumentApp.Attribute.FONT_SIZE]: 10 });
      body.appendParagraph(settings.schoolName).setHeading(DocumentApp.ParagraphHeading.HEADING1);
      body.appendParagraph('รายงานสถิติการมาเรียน').setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendParagraph('ช่วงวันที่ ' + report.range.dateFrom + ' ถึง ' + report.range.dateTo);
      if (payload.studentId) body.appendParagraph('เลขประจำตัวนักเรียน: ' + payload.studentId);
      if (payload.classroomId) body.appendParagraph('ห้องเรียน: ' + report.classrooms.map(room => room.name).join(', '));
      if (payload.advisorId) body.appendParagraph('ครูที่ปรึกษา: ' + [...new Set(report.classrooms.map(room => room.advisorName))].join(', '));
      if (payload.search) body.appendParagraph('คำค้น: ' + payload.search);
      if (settings.affiliation) body.appendParagraph(settings.affiliation);
      body.appendParagraph('ผู้จัดทำ: ' + actor.displayName + ' | จัดทำเมื่อ ' + Utilities.formatDate(new Date(), APP_CONFIG.timezone, 'dd/MM/yyyy HH:mm'));
      const totals = report.summary;
      body.appendTable([['มา','ขาด','สาย','ลา','ยังไม่เช็ค','ทั้งหมด','อัตรามาเรียน'],[totals.present,totals.absent,totals.late,totals.leave,totals.unmarked,totals.total,totals.rate+'%'].map(String)]);
      body.appendParagraph(report.attendanceRateDefinition);
      body.appendParagraph('สรุปรายวัน').setHeading(DocumentApp.ParagraphHeading.HEADING2);
      body.appendTable([['วันที่','มา','ขาด','สาย','ลา','ยังไม่เช็ค','รวม']].concat(report.daily.map(day => [day.date,day.present,day.absent,day.late,day.leave,day.unmarked,day.total].map(String))));
      if (report.byClassroom.length) {
        body.appendParagraph('สรุปรายห้องเรียน').setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendTable([['ห้องเรียน','ครูที่ปรึกษา','มา','ขาด','สาย','ลา','ยังไม่เช็ค']].concat(report.byClassroom.map(room => [room.classroomName,room.advisorName,room.present,room.absent,room.late,room.leave,room.unmarked].map(String))));
      }
      if (report.records.length) {
        const labels = { present:'มา', absent:'ขาด', late:'สาย', leave:'ลา' };
        body.appendParagraph('รายละเอียดการเช็คชื่อ').setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendTable([['วันที่','ห้อง','เลขประจำตัว','ชื่อ–สกุล','สถานะ','เหตุผล','พิกัด']].concat(report.records.map(record => [record.date,record.classroomName,record.studentId,record.fullName,labels[record.status] || record.status,record.reason || '-',record.locationRecorded ? Number(record.latitude).toFixed(5)+', '+Number(record.longitude).toFixed(5) : 'ไม่มีพิกัด'].map(String))));
      }
      body.appendParagraph(report.denominatorNote);
      document.saveAndClose();
      const pdf = documentFile.getAs(MimeType.PDF).setName(filename);
      const folder = DriveApp.getFolderById(APP_CONFIG.reportFolderId);
      if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new AppError('PRIVATE_FOLDER_REQUIRED', 'กรุณาปิดการแชร์แบบสาธารณะหรือทั้งองค์กรของโฟลเดอร์รายงานใน Google Drive ก่อนส่งออก PDF');
      const file = folder.createFile(pdf);
      // Override inherited link/domain sharing on the individual report. Folder members
      // may still have access; use a private school-controlled destination folder.
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      AuditLog.write(actor,'export_pdf',file.getId(),null,{ filename,range:report.range,classroomId:payload.classroomId || '',studentId:payload.studentId || '',recordCount:report.records.length },null,requestId);
      return { filename,mimeType:'application/pdf',base64:Utilities.base64Encode(pdf.getBytes()),fileId:file.getId() };
    } finally { if (documentFile) documentFile.setTrashed(true); }
  }
}
