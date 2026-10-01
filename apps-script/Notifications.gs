/** Notifications are opt-in and contain aggregate counts, not individual records. */
class NotificationService {
  static validateWebhook(url) {
    Validation.url(url, 'Chatbot URL');
    const match = /^https:\/\/([^/:?#]+)(?::(\d+))?(?:[/?#]|$)/i.exec(url);
    if (!match) throw new AppError('VALIDATION', 'Chatbot URL ไม่ถูกต้อง');
    const host = match[1].toLowerCase();
    if ((match[2] && match[2] !== '443') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes('..') || /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) || /\.(local|internal|localhost)$/.test(host)) throw new AppError('VALIDATION', 'Chatbot ต้องใช้โดเมน HTTPS สาธารณะและพอร์ต 443');
    return url;
  }
  static configureTrigger(enabled) {
    const triggers = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'dailyReportTick_');
    if (!enabled) { triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger)); return; }
    if (!triggers.length) ScriptApp.newTrigger('dailyReportTick_').timeBased().everyMinutes(5).create();
    if (triggers.length > 1) triggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  }
  static post(url, payload, headers) {
    const response = UrlFetchApp.fetch(url, { method:'post',contentType:'application/json',payload:JSON.stringify(payload),headers:headers || {},muteHttpExceptions:true,followRedirects:false,validateHttpsCertificates:true });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) throw new AppError('NOTIFICATION_FAILED', 'บริการแจ้งเตือนตอบกลับ HTTP ' + status);
    return response;
  }
  static tick() {
    return withLock_(() => {
      Database.assertPrivate();
      const settings = SettingsService.all();
      if (!settings.dailyReportEnabled || Utilities.formatDate(new Date(),APP_CONFIG.timezone,'HH:mm') < settings.reportTime) return { skipped:true };
      const date = today_(), properties = PropertiesService.getScriptProperties(), actor = { userId:'system',displayName:'ระบบแจ้งเตือน',role:'admin' };
      const report = ReportService.statistics(actor,{ date });
      const totals = report.summary;
      const text = settings.schoolName + '\nรายงานการมาเรียน ' + date + '\nมา ' + totals.present + ' | ขาด ' + totals.absent + ' | สาย ' + totals.late + ' | ลา ' + totals.leave + '\nยังไม่เช็ค ' + totals.unmarked + ' จาก ' + totals.total + ' คน\nอัตรามาเรียน ' + totals.rate + '%';
      const outcomes = [];
      ['line','telegram','chatbot'].forEach(channel => {
        if (!settings[channel + 'Enabled']) return;
        const receiptKey = 'DAILY_REPORT_' + channel.toUpperCase(), previous = properties.getProperty(receiptKey);
        if (previous && previous.split('|')[0] === date) return;
        // An ambiguous network failure is logged for admin review, never blindly
        // replayed: Telegram/webhooks do not promise idempotent sends.
        properties.setProperty(receiptKey,date + '|attempted');
        try {
          if (channel === 'line') {
            const token = properties.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
            if (!token || !settings.lineTargetId) throw new AppError('NOTIFICATION_CONFIG', 'LINE ยังไม่ได้ตั้งค่า');
            this.post('https://api.line.me/v2/bot/message/push',{ to:settings.lineTargetId,messages:[{ type:'text',text }] },{ Authorization:'Bearer ' + token,'X-Line-Retry-Key':uuid_() });
          } else if (channel === 'telegram') {
            const token = properties.getProperty('TELEGRAM_BOT_TOKEN');
            if (!token || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(token) || !settings.telegramChatId) throw new AppError('NOTIFICATION_CONFIG','Telegram ยังไม่ได้ตั้งค่า');
            const response = this.post('https://api.telegram.org/bot' + token + '/sendMessage',{ chat_id:settings.telegramChatId,text,disable_web_page_preview:true });
            if (!JSON.parse(response.getContentText()).ok) throw new AppError('NOTIFICATION_FAILED','Telegram ไม่รับข้อความ');
          } else {
            const token = properties.getProperty('CHATBOT_TOKEN');
            if (!token || !settings.chatbotUrl) throw new AppError('NOTIFICATION_CONFIG','Chatbot ยังไม่ได้ตั้งค่า');
            this.post(this.validateWebhook(settings.chatbotUrl),{ type:'daily_attendance',date,schoolName:settings.schoolName,summary:totals,text },{ Authorization:'Bearer ' + token });
          }
          properties.setProperty(receiptKey,date + '|sent');
          AuditLog.write(actor,'notification_sent',channel,null,{ date,channel,summary:totals },null,'');
          outcomes.push({ channel,sent:true });
        } catch (error) {
          // Never record provider response bodies or credential-bearing request URLs.
          const code = error instanceof AppError ? error.code : 'NETWORK_ERROR';
          properties.setProperty(receiptKey,date + '|failed');
          AuditLog.write(actor,'notification_failed',channel,null,{ date,channel,code },null,'');
          outcomes.push({ channel,sent:false,error:code });
        }
      });
      return { date,outcomes };
    });
  }
}

/** Private function name: callable by installed time triggers, not google.script.run. */
function dailyReportTick_() { return NotificationService.tick(); }
