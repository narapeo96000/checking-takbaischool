class AttendanceService {
  static batch(date, classroomId) {
    return Database.repo('attendance_batches').find('batchId', date + ':' + classroomId) || { batchId: date + ':' + classroomId, date, classroomId, revision: 0, updatedAt: '', updatedBy: '' };
  }
  static summary(records, total, configuredWeights) {
    const result = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0, total: total || 0, rate: 0 };
    records.forEach(record => { if (APP_CONFIG.statuses.includes(record.status)) result[record.status]++; });
    result.unmarked = Math.max(0, result.total - result.present - result.absent - result.late - result.leave);
    const weights = Object.assign({ present: 1, leave: 0.5, late: 0.25, absent: 0 }, configuredWeights || SettingsService.all().attendanceWeights || {});
    const score = result.present * Number(weights.present) + result.leave * Number(weights.leave) + result.late * Number(weights.late) + result.absent * Number(weights.absent);
    result.rate = result.total ? Math.round(score / result.total * 10000) / 100 : 0;
    return result;
  }
  static get(actor, payload) {
    const date = Validation.date(payload.date || today_()), classroomId = Validation.id(payload.classroomId, 'ห้องเรียน');
    Authorization.classroom(actor, classroomId);
    return withLock_(() => {
      const students = AdminService.students(actor, { classroomId }), records = Database.repo('attendance').all().filter(record => record.date === date && record.classroomId === classroomId).map(record => SheetRepository.clean(record));
      const studentIds = new Set(students.map(student => student.studentId));
      records.forEach(record => studentIds.add(record.studentId));
      const batch = this.batch(date, classroomId);
      return { date, classroomId, students, records, summary: this.summary(records, studentIds.size), revision: Number(batch.revision), updatedAt: batch.updatedAt };
    });
  }
  static stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(item => this.stableJson(item)).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + this.stableJson(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  static mutate(actor, payload, requestId, clear) {
    const date = Validation.date(payload.date || today_()), classroomId = Validation.id(payload.classroomId, 'ห้องเรียน');
    const room = Authorization.classroom(actor, classroomId);
    if (!Validation.bool(room.active)) throw new AppError('VALIDATION', 'ห้องเรียนนี้ปิดใช้งานแล้ว');
    if (date > today_()) throw new AppError('VALIDATION', 'ไม่สามารถเช็คชื่อล่วงหน้าได้');
    const mutationId = Validation.id(payload.mutationId, 'รหัสการบันทึก');
    if (!Number.isInteger(payload.baseRevision) || payload.baseRevision < 0) throw new AppError('VALIDATION', 'กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
    const action = clear ? 'clear_attendance' : 'save_attendance';
    if (!clear && (!Array.isArray(payload.records) || !payload.records.length || payload.records.length > 1000)) throw new AppError('VALIDATION', 'กรุณาระบุรายการเช็คชื่อ 1–1000 รายการ');
    return withLock_(() => {
      // Re-check the current ACL inside the write lock, after possible admin changes.
      const currentActor = Database.repo('users').find('userId', actor.userId);
      if (!currentActor || !Validation.bool(currentActor.active)) throw new AppError('UNAUTHORIZED', 'บัญชีนี้ไม่ได้เปิดใช้งาน');
      if (Validation.bool(currentActor.mustChangePassword)) throw new AppError('PASSWORD_CHANGE_REQUIRED', 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน');
      Authorization.classroom(currentActor, classroomId);
      const mutations = Database.repo('mutations'), fingerprint = PasswordCrypto.hash(this.stableJson(payload)), prior = mutations.find('mutationId', mutationId);
      if (prior) {
        if (prior.userId !== actor.userId || prior.action !== action || prior.payloadHash !== fingerprint) throw new AppError('CONFLICT', 'รหัสการบันทึกนี้ถูกใช้กับข้อมูลอื่นแล้ว');
        return Object.assign(JSON.parse(prior.resultJson), { deduplicated: true });
      }
      const location = Validation.location(payload);
      const batches = Database.repo('attendance_batches'), batch = this.batch(date, classroomId);
      if (Number(batch.revision) !== payload.baseRevision) throw new AppError('CONFLICT', 'ข้อมูลถูกแก้ไขจากอุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุด', { revision: Number(batch.revision) });
      const attendance = Database.repo('attendance'), all = attendance.all(), existing = all.filter(record => record.date === date && record.classroomId === classroomId);
      const duplicateKeys = new Set();
      all.filter(record => record.date === date).forEach(record => { if (duplicateKeys.has(record.studentId)) throw new AppError('DATA_INTEGRITY', 'พบการเช็คชื่อซ้ำในชีต กรุณาให้ผู้ดูแลตรวจสอบ'); duplicateKeys.add(record.studentId); });
      const time = nowIso_(), changes = [];
      if (clear) {
        attendance.removeRows(existing.map(record => record._row));
        AuditLog.write(actor, action, date + ':' + classroomId, existing.map(record => SheetRepository.clean(record)), [], location, requestId);
      } else {
        const students = Database.repo('students').all(), seen = new Set();
        // Validate the complete request before writing any attendance row.
        payload.records.forEach(input => {
          const studentId = Validation.id(input.studentId, 'เลขประจำตัวนักเรียน');
          if (seen.has(studentId)) throw new AppError('VALIDATION', 'รายชื่อนักเรียนซ้ำในคำขอ'); seen.add(studentId);
          const student = students.find(item => item.studentId === studentId && item.classroomId === classroomId && Validation.bool(item.active));
          if (!student) throw new AppError('FORBIDDEN', 'นักเรียนไม่อยู่ในห้องเรียนที่เลือกหรือปิดใช้งานแล้ว');
          if (!APP_CONFIG.statuses.includes(input.status)) throw new AppError('VALIDATION', 'สถานะการเช็คชื่อไม่ถูกต้อง');
          const previous = all.find(record => record.date === date && record.studentId === studentId);
          if (previous && previous.classroomId !== classroomId) throw new AppError('CONFLICT', 'นักเรียนมีข้อมูลของวันที่นี้ในห้องเรียนอื่นแล้ว');
          const next = Object.assign({}, previous || {}, { attendanceId: date + ':' + studentId, date, classroomId, studentId, status: input.status, reason: Validation.text(input.reason, 1000), latitude: location.location ? location.location.latitude : '', longitude: location.location ? location.location.longitude : '', accuracy: location.location ? location.location.accuracy : '', capturedAt: location.location ? location.location.capturedAt : '', locationError: location.locationError, updatedBy: actor.userId, updatedAt: time });
          changes.push({ previous, next });
        });
        changes.forEach(change => { if (change.previous) attendance.update(change.next); else attendance.append(change.next); });
        AuditLog.write(actor, action, date + ':' + classroomId, changes.map(change => SheetRepository.clean(change.previous)), changes.map(change => SheetRepository.clean(change.next)), location, requestId);
      }
      const result = { saved: true, cleared: !!clear, date, classroomId, revision: Number(batch.revision) + 1, updatedAt: time, count: clear ? existing.length : changes.length, locationRecorded: !!location.location };
      const updatedBatch = Object.assign({}, batch, { revision: result.revision, updatedAt: time, updatedBy: actor.userId });
      if (batch._row) batches.update(updatedBatch); else batches.append(updatedBatch);
      mutations.append({ mutationId, userId: actor.userId, action, payloadHash: fingerprint, resultJson: JSON.stringify(result), createdAt: time });
      PublicStatsService.refreshDate(date);
      SpreadsheetApp.flush();
      return result;
    });
  }
}

class PublicStatsService {
  static refreshDate(date) {
    const students = Database.repo('students').all().filter(student => Validation.bool(student.active));
    const records = Database.repo('attendance').all().filter(record => record.date === date);
    const summary = AttendanceService.summary(records, students.length, SettingsService.all().attendanceWeights);
    const repo = Database.repo('public_stats'), existing = repo.find('date', date);
    const row = Object.assign({}, existing || {}, { date, present: summary.present, absent: summary.absent, late: summary.late, leave: summary.leave, unmarked: summary.unmarked, total: summary.total, rate: summary.rate, updatedAt: nowIso_() });
    if (existing) repo.update(row); else repo.append(row);
    return row;
  }
}
