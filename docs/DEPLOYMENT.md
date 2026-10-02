# คู่มือติดตั้งและเผยแพร่

การติดตั้งมีสองส่วน: GitHub Pages สำหรับหน้าเว็บ และ Google Apps Script สำหรับยืนยันตัวตน อ่านเขียน Sheet สร้าง PDF และตรวจสิทธิ์ ผู้ติดตั้ง Google Apps Script ต้องเข้าถึง Google Sheet และโฟลเดอร์ Drive ที่กำหนดได้

## 1. เตรียม Google Sheet และ Drive

ใช้บัญชี Google ของผู้ดูแลที่มีสิทธิ์แก้ไข [ฐานข้อมูล](https://docs.google.com/spreadsheets/d/1nqfPAnIifkQV3NrD045__PNK7qe3n-cxBcdeqvfBwUw/edit) และสร้างไฟล์ใน [โฟลเดอร์รายงาน](https://drive.google.com/drive/folders/1TL_yuWS76ri3H6xcrscIA_jQbGQTx63X) จำกัดการแชร์เฉพาะผู้เกี่ยวข้อง เพราะมีข้อมูลนักเรียน ประวัติการใช้ระบบ และพิกัด

ทั้ง Google Sheet และโฟลเดอร์รายงานต้องตั้ง **General access → Restricted / การเข้าถึงทั่วไป → จำกัด** แล้วเพิ่มเฉพาะบัญชีโรงเรียนที่จำเป็น ระบบจะปฏิเสธฐานข้อมูลที่แชร์ให้ทุกคนหรือทั้งโดเมนด้วยรหัส `PRIVATE_DATABASE_REQUIRED` ก่อนสร้างชีตหรือบัญชี และตรวจซ้ำทุกครั้งที่เรียก API โปรแกรมไม่เปลี่ยนสิทธิ์แชร์เอง ห้ามเผยแพร่ Sheet เป็นเว็บไซต์หรืออนุญาตให้นักเรียนอ่านตาราง users/sessions โดยตรง

โครงการ Apps Script ที่ระบุคือ [takbai-checking](https://script.google.com/home/projects/11_Wu-jK9NG8_CD90P0FPWqyt46TdyOUjiykwSZcSN5Kgpkwg5UrWYRjZ/edit) รหัสนี้เป็น Script ID ไม่ใช่ OAuth token จึงยังต้องลงชื่อเข้าใช้บัญชีเจ้าของและอนุญาตสิทธิ์ Google

โปรแกรมเปิดไฟล์ด้วย ID จึงใช้ได้ทั้ง Apps Script ที่ผูกกับ Sheet และโครงการแยก ตาม [เอกสาร Web Apps ของ Google](https://developers.google.com/apps-script/guides/web)

## 2. ติดตั้ง backend และสร้างชีต

1. เปิด Sheet แล้วเลือก **Extensions → Apps Script** หรือสร้างโครงการจาก [Apps Script](https://script.google.com/)
2. เพิ่มไฟล์ `.gs` และ HTML ทุกไฟล์จาก `apps-script/` โดยใช้ชื่อเดียวกับใน repository

   ทางเลือกสำหรับติดตั้งสะดวก: เรียก `npm run bundle` แล้วคัดลอก `artifacts/Code.gs` เป็นไฟล์ Code.gs เดียว เพิ่ม `artifacts/Bridge.html` และใช้ `artifacts/appsscript.json` ห้ามใส่ทั้ง Code.gs รวมและไฟล์ .gs แยกพร้อมกัน เพราะจะประกาศคลาสซ้ำ
3. ที่ **Project Settings** เปิดการแสดง manifest แล้วแทนที่ `appsscript.json` ด้วยไฟล์ที่ให้มา ตรวจว่าใช้ V8 และ timezone `Asia/Bangkok`
4. ตรวจค่า Spreadsheet ID และ Drive Folder ID ใน `Config.gs` ว่าตรงกับปลายทางข้างต้น
5. เลือกฟังก์ชัน `setupSystem` แล้วกด **Run** จาก editor เจ้าของโครงการต้องอนุญาตสิทธิ์ Google ที่จำเป็นต่อ Sheet, Docs, Drive และ trigger
6. เปิด **Execution log** เพื่อรับบัญชีเริ่มต้น username `admin` และรหัสผ่านสุ่มชั่วคราว เก็บเฉพาะช่องทางส่วนตัวและเปลี่ยนทันทีเมื่อเข้าสู่ระบบ การเรียก `setupSystem()` หลังอัปเดตจะสร้างชีต `user_emails` และ `password_resets` โดยไม่ลบข้อมูลเดิม

`setupSystem()` สร้างชีตที่ยังไม่มีและตรวจหัวคอลัมน์เดิม เรียกซ้ำได้โดยไม่ลบข้อมูลเดิม ไม่เพิ่มนักเรียนหรือครูตัวอย่างลงฐานข้อมูลจริง หากหัวคอลัมน์ไม่ตรงให้สำรองและแก้โครงสร้างก่อนรันซ้ำ รายละเอียดใน [DATABASE.md](DATABASE.md)

ขั้นตอนนี้ต้องสำเร็จในบัญชี Google จริงก่อนจึงจะกล่าวได้ว่าชีตถูกสร้างแล้ว การเก็บไฟล์ `.gs` บน GitHub ยังไม่สร้างชีตหรืออนุญาต OAuth

## 3. เผยแพร่ Web App

1. เลือก **Deploy → New deployment → Web app**
2. ตั้ง **Execute as: Me** และ **Who has access: Anyone** เพื่อให้ frontend เรียก bridge ได้
3. กด Deploy และอนุญาตสิทธิ์ที่ Google ขอ คัดลอก URL ที่ลงท้าย `/exec`
4. เปิด `/exec` ในหน้าต่างส่วนตัวเพื่อยืนยันว่าไม่ติดหน้า Google login การเปิดโดยตรงจะแสดงข้อความให้เข้าใช้งานผ่านเว็บไซต์โรงเรียน
5. URL ของ Web App ที่เผยแพร่แล้วกำหนดใน `config.js` หน้าเว็บอ่านค่านี้และตรวจการเชื่อมต่อเมื่อเริ่มต้น รอข้อความเชื่อมต่อสำเร็จแล้วเข้าสู่ระบบด้วยบัญชีแอป หากเปลี่ยน deployment ให้แก้ `apiUrl` และเผยแพร่ frontend ใหม่ หรือใส่ URL ใหม่ในหน้าตั้งค่าการเชื่อมต่อของอุปกรณ์

การตั้ง Anyone เปิดให้เข้าถึงจุดเชื่อมต่อได้ แต่ข้อมูลนักเรียนและการบันทึกต้องผ่าน session และสิทธิ์บน backend ครูที่เข้าสู่ระบบดูและค้นหารายชื่อนักเรียนได้ทุกห้อง แต่เช็คชื่อ แก้ไข ล้างข้อมูล และดูรายงานละเอียดได้เฉพาะห้องที่ได้รับมอบหมาย ผู้ดูแลเข้าถึงการตั้งค่าได้ ห้ามนำ OAuth token ของเจ้าของ Google ไปใส่ frontend ตาม [ข้อควรระวังของ Google](https://developers.google.com/apps-script/guides/web)

บัญชี Google Workspace บางองค์กรจำกัดการเผยแพร่ภายนอก หากไม่มี Anyone ให้ผู้ดูแลโดเมนตรวจนโยบาย audience แบบอื่นต้องทดสอบกับผู้ใช้จริงทุกกลุ่ม ใช้ `/exec` สำหรับงานจริง `/dev` ใช้ทดสอบสำหรับผู้มีสิทธิ์แก้ไขโครงการ เมื่อแก้โค้ดแล้วเลือก **Deploy → Manage deployments → Edit → New version → Deploy** เพื่ออัปเดต deployment เดิม

ค่า `allowedOrigins` ใน `Config.gs` อนุญาต origin `https://narapeo96000.github.io`, `http://localhost:4173` และ `http://127.0.0.1:4173` ถ้าเปลี่ยนโดเมน ให้เพิ่ม origin ที่จำเป็นโดยไม่มี path แล้วเผยแพร่เวอร์ชันใหม่ ห้ามใช้ wildcard แทนการตรวจ origin

Frontend ตั้ง iframe เชื่อมต่อเป็น `credentialless` ก่อนโหลด Web App เพื่อให้เบราว์เซอร์ที่รองรับใช้บริบทชั่วคราวที่แยกจากคุกกี้และข้อมูลบัญชี Google เดิม ฟีเจอร์นี้ยังรองรับไม่ครบทุกเบราว์เซอร์ตาม [MDN: HTMLIFrameElement.credentialless](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/credentialless) การแยกบริบทช่วยลดปัญหาการเลือกบัญชี Google หลายบัญชี โดยยังตรวจ origin, nonce, session และสิทธิ์ของบัญชีแอปตามเดิม ผู้ใช้ครูเข้าสู่ระบบด้วยบัญชีของแอป

## 4. เผยแพร่ GitHub Pages

1. นำโค้ดขึ้น [repository](https://github.com/narapeo96000/checking-takbaischool) บน branch `main`
2. เลือก **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. เปิด **Actions → Publish attendance app to GitHub Pages → Run workflow** หรือ push ขึ้น `main`
4. ตรวจ job `build` และ `deploy` ว่าสำเร็จ แล้วเปิด [หน้าเว็บ](https://narapeo96000.github.io/checking-takbaischool/)

Workflow แพ็กเฉพาะ `index.html`, `config.js`, `assets/` และไอคอนที่ระบุ ไม่แพ็ก backend, เอกสาร หรือการทดสอบ งาน build ใช้สิทธิ์อ่าน repository และข้อมูล Pages งาน deploy ใช้เฉพาะสิทธิ์ Pages และ OIDC ตาม [คู่มือ GitHub Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

URL ของ Web App เป็นค่าการเชื่อมต่อสาธารณะ ห้ามใส่รหัสผ่านหรือ token ใน workflow, frontend, URL หรือ GitHub Actions log

## 5. ตั้งค่าเริ่มใช้งาน

- เปลี่ยนรหัสผ่าน `admin` ระบบบังคับเปลี่ยนก่อนทำงานอื่น
- บันทึกอีเมลของผู้ใช้แต่ละคนในเมนูจัดการผู้ใช้งาน เพื่อให้เจ้าของบัญชีขอรหัสรีเซ็ตได้เอง รหัสส่งด้วย MailApp ใช้ครั้งเดียวและหมดอายุ 15 นาที
- รหัสผ่านใหม่และรหัสผ่านชั่วคราวของบัญชีที่เพิ่มต้องยาวอย่างน้อย 8 ตัว (ไม่เกิน 128 ตัว) โดยใช้ตัวเลขล้วนได้ รหัสผ่านใหม่เก็บเป็นข้อความในคอลัมน์ password ของ users ส่วนแฮชเดิมยังใช้เข้าสู่ระบบได้จนกว่าจะเปลี่ยนรหัสผ่าน
- เพิ่มครูและห้องเรียน กำหนดห้องให้ครูแต่ละคน แล้วเพิ่มนักเรียน
- รักษาเลขประจำตัวเป็นข้อความเพื่อไม่ให้เลขศูนย์นำหน้าหาย
- ตั้งข้อมูลโรงเรียน โลโก สีหลัก/สีรอง ผู้อำนวยการ และรองผู้อำนวยการไม่เกินสามคน
- กำหนดเวลารายงาน เช่น `08:10` และ timezone `Asia/Bangkok`
- ใช้โทรศัพท์ทดสอบพิกัด การบันทึกอัตโนมัติ การส่งรายการค้าง และการดาวน์โหลด PDF

หากลืมรหัสผ่าน ให้เจ้าของโครงการเรียก `resetAdminPassword()` จาก Apps Script editor ดูรหัสผ่านชั่วคราวใน Execution log และเปลี่ยนทันที อย่าเปิดฟังก์ชันนี้เป็น API สาธารณะ

## 6. PDF และเวลารายงาน

backend สร้าง Google Docs ชั่วคราว แปลงเป็น PDF เก็บในโฟลเดอร์รายงาน และคืนเนื้อหาไฟล์ให้คำขอที่ตรวจสิทธิ์แล้ว โค้ดไม่เปิดแชร์ PDF แบบสาธารณะ โฟลเดอร์รายงานต้องตั้ง General access เป็น **Restricted** ระบบปฏิเสธโฟลเดอร์ที่เปิดสาธารณะหรือแชร์ทั้งโดเมน สมาชิกที่แชร์สิทธิ์เฉพาะไว้กับโฟลเดอร์ยังอาจมีสิทธิ์สืบทอดมายังไฟล์

ตัวตรวจรายงานทำงานทุกประมาณ 5 นาที ตรวจเวลาไทยว่าถึง `reportTime` และจดผลรายวันเพื่อหลีกเลี่ยงส่งซ้ำ Apps Script ไม่รับประกันเวลาเริ่มตรงนาที คิวและโควตาทำให้ช้าได้ ส่วน trigger ชนิด `nearMinute()` มีช่วงประมาณ ±15 นาทีตาม [ClockTriggerBuilder](https://developers.google.com/apps-script/reference/script/clock-trigger-builder) ให้ตีความ `08:10` เป็นเวลาเป้าหมายและตรวจผลจาก log

## 7. ช่องทางแจ้งเตือน

การแจ้งเตือนปิดเป็นค่าเริ่มต้น กรอกค่าที่หน้า **ตั้งค่า** แล้วเปิดเมื่อได้รับอนุญาตให้ส่งจริง

| ช่องทาง | ค่าที่ต้องมี |
| --- | --- |
| LINE Messaging API | Channel access token และ user/group/room ID |
| Telegram | Bot token และ chat ID |
| Chatbot | HTTPS endpoint และ Bearer token |

LINE Notify ยุติบริการแล้วเมื่อ 31 มีนาคม 2568 ให้ใช้ [Messaging API](https://developers.line.biz/en/news/2025/04/01/line-notify/) token อย่างเดียวไม่ระบุว่าจะส่งให้ใคร ผู้รับและโควตาข้อความขึ้นกับบริการปลายทาง

ความลับเก็บใน Script Properties หน้าเว็บคืนเพียงสถานะว่ากำหนดค่าแล้ว กรอก token ใหม่เมื่อต้องการแทนที่ token เดิม ห้ามแชร์สิทธิ์แก้ไข Apps Script ให้ผู้ที่ไม่ควรอ่านความลับ

ระบบพยายามส่งแต่ละช่องทางได้หนึ่งครั้งต่อวันและบันทึก `notification_sent` หรือ `notification_failed` ใน `logs` หากเครือข่ายให้ผลไม่ชัดเจน ระบบไม่ส่งซ้ำอัตโนมัติในวันนั้นเพื่อป้องกันข้อความซ้ำ ผู้ดูแลต้องตรวจผลที่ปลายทางและ log ก่อนจัดการส่งใหม่

## 8. ตรวจการทำงานก่อนเปิดใช้

| ทดสอบ | ผลที่ต้องเห็น |
| --- | --- |
| เรียก `setupSystem()` ซ้ำ | ไม่มีข้อมูลเดิมถูกลบหรือชีตซ้ำ |
| ไม่เข้าสู่ระบบแล้วขอรายชื่อ | backend ปฏิเสธ |
| ครูเปิดห้องที่ไม่ได้รับมอบหมาย | backend ปฏิเสธ |
| เช็คชื่อและแก้เหตุผล | อัปเดตแถววันเดิมและมีประวัติใน `logs` |
| บันทึกซ้ำวัน/นักเรียนเดิม | สถิติไม่นับซ้ำ |
| กรองรายคน | ต้องระบุเลขประจำตัวนักเรียน |
| ปิดเครือข่ายแล้วเปลี่ยนสถานะ | แสดงรอส่ง |
| กลับมาออนไลน์ | ส่งรายการค้างและสถิติตรงกับ Sheet |
| ไม่อนุญาตพิกัด | บันทึกเหตุที่เก็บไม่ได้ ไม่สร้างพิกัดสมมุติ |
| PDF | อ่านภาษาไทยได้ ข้อมูลตรงตัวกรองและไม่เปิดแชร์สาธารณะ |
| บันทึก token | token ไม่อยู่ใน frontend หรือคำตอบอ่านค่าทั่วไป |

การตรวจในเครื่องไม่แทน deployment จริง โดยเฉพาะสิทธิ์ Google, iframe bridge, trigger, พิกัดบนมือถือ และ PDF

## แก้ปัญหา

**เชื่อมต่อ timeout:** ตรวจ URL `/exec`, deployment เวอร์ชันล่าสุด, audience และ OAuth ของเจ้าของ ดู Apps Script Executions ประกอบ HtmlService อยู่ภายใน iframe ของ Google และใช้ HTTPS ตาม [ข้อจำกัด HTML Service](https://developers.google.com/apps-script/guides/html/restrictions) ต้องทดสอบ bridge บน browser ที่โรงเรียนใช้

**เชื่อมต่อ timeout หรือ Google เปลี่ยน URL เป็น `/macros/u/...` แล้วขึ้นไม่พบเพจ:** อาจเกี่ยวกับการลงชื่อเข้าใช้ Google หลายบัญชี หากเบราว์เซอร์ไม่รองรับหรือไม่ใช้ `credentialless` ให้ทดลองเปิดหน้าเว็บโรงเรียนในหน้าต่างไม่ระบุตัวตนใหม่ หรือโปรไฟล์เบราว์เซอร์ที่ใช้ Google บัญชีเดียว Google ระบุว่า Apps Script ไม่รองรับ multi-login และแนะนำการแยกบัญชีหรือใช้หน้าต่างส่วนตัวใน [คู่มือแก้ปัญหาหลายบัญชี](https://developers.google.com/apps-script/guides/support/troubleshooting#issues_with_multiple_google_accounts) ซิงก์รายการค้างในเบราว์เซอร์เดิมให้หมดก่อนเปลี่ยนโปรไฟล์หรือหน้าต่าง ไม่ต้องผ่อนการตรวจ origin/nonce หรือเปิด Sheet เป็นสาธารณะเพื่อแก้ปัญหานี้

**iframe ถูกบล็อก:** ตรวจว่าติดตั้ง HTML ครบและ `doGet()` ใช้ `XFrameOptionsMode.ALLOWALL` ตาม [API อ้างอิง](https://developers.google.com/apps-script/reference/html/x-frame-options-mode) ถ้ายังถูกบล็อกให้ตรวจนโยบายโดเมนและ response headers ของ deployment จริง ห้ามผ่อนการตรวจ origin/session เพื่อแก้ timeout

**PDF เปิด Drive ไม่ได้:** ดาวน์โหลดในแอปใช้เนื้อหา PDF ผ่าน backend ลิงก์ Drive ส่วนตัวต้องเปิดด้วยบัญชี Google ที่ได้รับการแชร์ด้วย

**วันหรือเวลาไม่ตรง:** ตรวจ timezone ของ Script และ Sheet เป็น `Asia/Bangkok` วันที่ข้อมูลใช้ `YYYY-MM-DD` และเวลาใช้ ISO timestamp

**เกินโควตา:** ดู [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) จำนวนผู้ใช้และข้อมูลมีผลต่อเวลารัน พิจารณาแบ่งช่วงรายงานและสำรองชีตเป็นรอบ

## clasp (ตัวเลือก)

ใช้ [clasp ของ Google](https://developers.google.com/apps-script/guides/clasp) แทนคัดลอกไฟล์ได้ สร้าง `.clasp.json` ในเครื่องพร้อม script ID จริง:

```json
{
  "scriptId": "YOUR_GOOGLE_APPS_SCRIPT_PROJECT_ID",
  "rootDir": "apps-script"
}
```

อนุญาตด้วยบัญชีเจ้าของเอง อย่า commit credential ของ clasp หรือ token `clasp push` อัปเดต source แต่ยังต้องอัปเดต deployment เป็นเวอร์ชันใหม่และตรวจสิทธิ์ Google
