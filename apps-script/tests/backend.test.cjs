/* Offline service tests. Deployment QA must still exercise actual Google services. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

class FakeSheet {
  constructor(name) { this.name=name;this.rows=[];this.maxRows=1000; }
  getLastRow() { let i=this.rows.length;while(i && !(this.rows[i-1]||[]).some(v=>v!==''&&v!=null))i--;return i; }
  getMaxColumns() { return 30; }
  getMaxRows() { return this.maxRows; }
  getRange(r,c,n,m) {
    const s=this;
    return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>s.rows[r+i-1]?.[c+j-1]??'')),
      setValues(values) { values.forEach((row,i)=>{s.rows[r+i-1]||=[];row.forEach((v,j)=>{s.rows[r+i-1][c+j-1]=v;});});return this; },
      setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},setNumberFormat(){return this;}
    };
  }
  setFrozenRows(){} autoResizeColumns(){} insertColumnsAfter(){}
  insertRowsAfter(r,n){this.maxRows+=n;}
  deleteRow(r){this.rows.splice(r-1,1);}
}
const state={sheets:new Map(),cache:new Map(),properties:new Map(),logs:[],fetches:[],triggers:[],activeEmail:'owner@school.example',effectiveEmail:'owner@school.example',lockHeld:false,sharingAccess:'PRIVATE'};
const spreadsheet={getSheetByName:n=>state.sheets.get(n)||null,insertSheet(n){const s=new FakeSheet(n);state.sheets.set(n,s);return s;},setSpreadsheetTimeZone:t=>{state.timezone=t;}};
function formatDate(date,timezone,format) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  if(format==='yyyy-MM-dd')return `${p.year}-${p.month}-${p.day}`;
  if(format==='HH:mm')return `${p.hour}:${p.minute}`;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
const api=vm.createContext({
  console:{log:(...a)=>state.logs.push(a.join(' ')),error:(...a)=>state.logs.push(a.join(' '))},
  SpreadsheetApp:{openById:()=>spreadsheet,flush:()=>{}},
  DriveApp:{Access:{PRIVATE:'PRIVATE',ANYONE:'ANYONE',ANYONE_WITH_LINK:'ANYONE_WITH_LINK',DOMAIN:'DOMAIN',DOMAIN_WITH_LINK:'DOMAIN_WITH_LINK'},getFileById:()=>({getSharingAccess:()=>state.sharingAccess})},
  Utilities:{getUuid:()=>crypto.randomUUID(),formatDate,newBlob:t=>({getBytes:()=>[...Buffer.from(t)]}),base64Encode:b=>Buffer.from(b).toString('base64')},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(state.lockHeld)return false;state.lockHeld=true;return true;},releaseLock:()=>{state.lockHeld=false;}})},
  CacheService:{getScriptCache:()=>({get:k=>state.cache.get(k)??null,put:(k,v)=>state.cache.set(k,v),remove:k=>state.cache.delete(k)})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>state.properties.get(k)??null,setProperty:(k,v)=>state.properties.set(k,v),deleteProperty:k=>state.properties.delete(k)})},
  Session:{getActiveUser:()=>({getEmail:()=>state.activeEmail}),getEffectiveUser:()=>({getEmail:()=>state.effectiveEmail})},
  ScriptApp:{getProjectTriggers:()=>state.triggers,deleteTrigger:t=>{state.triggers=state.triggers.filter(x=>x!==t);},newTrigger:n=>({timeBased(){return this;},everyMinutes(m){this.minutes=m;return this;},create(){state.triggers.push({getHandlerFunction:()=>n,minutes:this.minutes});}})},
  UrlFetchApp:{fetch:(url,options)=>{state.fetches.push({url,options});return {getResponseCode:()=>200,getContentText:()=>'{"ok":true}'};}},
  MailApp:{sendEmail:message=>{state.mail=message;}}
});
const directory=path.join(__dirname,'..');
for(const n of fs.readdirSync(directory).filter(n=>n.endsWith('.gs')))vm.runInContext(fs.readFileSync(path.join(directory,n),'utf8'),api,{filename:n});
vm.runInContext('Object.assign(globalThis,{APP_CONFIG,SHEET_SCHEMAS,DEFAULT_SETTINGS,AppError,Validation,Database,SheetRepository,PasswordCrypto,AuthService,Authorization,AdminService,SettingsService,AttendanceService,ReportService,NotificationService,UserEmailService,PasswordResetService});',api);
function reset(){state.sheets.clear();state.cache.clear();state.properties.clear();state.logs=[];state.fetches=[];state.triggers=[];state.mail=null;state.lockHeld=false;state.sharingAccess='PRIVATE';state.activeEmail=state.effectiveEmail='owner@school.example';api.Database.instance=null;api.Database.initialize();}
const fixturePassword='Secure-pass-123!',fixtureSalt='unit-test-account-salt';
const fixtureHash=crypto.pbkdf2Sync(fixturePassword,fixtureSalt,1024,32,'sha256').toString('hex');
function seed(){
  const now=new Date().toISOString(),yesterday=new Date(Date.now()-86400000).toISOString();
  const credentials={passwordSalt:fixtureSalt,passwordHash:fixtureHash,passwordIterations:1024};
  [
    {userId:'admin-1',username:'admin',displayName:'ผู้ดูแล',role:'admin',classroomIds:'[]',active:true,mustChangePassword:false},
    {userId:'advisor-a',username:'teacher.a',displayName:'ครู เอ',role:'advisor',classroomIds:'[]',active:true,mustChangePassword:false},
    {userId:'advisor-b',username:'teacher.b',displayName:'ครู บี',role:'advisor',classroomIds:'[]',active:true,mustChangePassword:false}
  ].forEach(u=>api.Database.repo('users').append({...u,...credentials,createdAt:now,updatedAt:now}));
  api.Database.repo('classrooms').append({classroomId:'A',name:'ม.1/1',level:'ม.1',advisorId:'advisor-a',active:true,createdAt:yesterday,updatedAt:now});
  api.Database.repo('classrooms').append({classroomId:'B',name:'ม.1/2',level:'ม.1',advisorId:'advisor-b',active:true,createdAt:yesterday,updatedAt:now});
  [
    {studentId:'00001',prefix:'เด็กชาย',firstName:'สมชาย',lastName:'ใจดี',classroomId:'A',number:1},
    {studentId:'00002',prefix:'เด็กหญิง',firstName:'สมหญิง',lastName:'ใจดี',classroomId:'A',number:2},
    {studentId:'00003',prefix:'เด็กชาย',firstName:'อื่น',lastName:'ห้องสอง',classroomId:'B',number:1}
  ].forEach(s=>api.Database.repo('students').append({...s,active:true,createdAt:yesterday,updatedAt:now}));
  return {admin:api.Database.repo('users').find('userId','admin-1'),teacher:api.Database.repo('users').find('userId','advisor-a')};
}
function mutation(records,extra={}){return {date:api.today_(),classroomId:'A',records,location:null,locationError:'ผู้ใช้ไม่อนุญาตตำแหน่ง',baseRevision:0,mutationId:crypto.randomUUID(),...extra};}
function login(username='teacher.a'){const r=api.dispatch({action:'login',payload:{username,password:fixturePassword},requestId:crypto.randomUUID()});assert.equal(r.ok,true);return r.data;}
function plain(v){return JSON.parse(JSON.stringify(v));}
test.beforeEach(reset);

test('SHA-256 and PBKDF2 match independent crypto vectors',()=>{
  for(const s of ['', 'abc','สวัสดีภาษาไทย','a'.repeat(500)])assert.equal(api.PasswordCrypto.hash(s),crypto.createHash('sha256').update(s).digest('hex'));
  for(const n of [1,2,4096])assert.equal(api.PasswordCrypto.derive('password','salt',n),crypto.pbkdf2Sync('password','salt',n,32,'sha256').toString('hex'));
  const c=api.PasswordCrypto.credentials(fixturePassword);assert.equal(c.password,fixturePassword);assert.equal(c.passwordHash,'');assert.equal(c.passwordSalt,'');assert.equal(c.passwordIterations,'');assert.equal(api.PasswordCrypto.verify(fixturePassword,c),true);assert.equal(api.PasswordCrypto.verify('incorrect',c),false);
});

test('password policy accepts numeric eight-character passwords and rejects short values',()=>{
  assert.equal(api.PasswordCrypto.password('01234567'),'01234567');
  assert.equal(api.PasswordCrypto.password('abcdefgh'),'abcdefgh');
  assert.throws(()=>api.PasswordCrypto.password('1234567'),e=>e.code==='VALIDATION');
});

test('initialization preserves data, is idempotent, seeds no people and rejects bad headers',()=>{
  assert.equal(api.Database.repo('students').all().length,0);assert.deepEqual([...state.sheets.keys()].sort(),Object.keys(api.SHEET_SCHEMAS).sort());
  const n=api.Database.repo('settings').all().length;api.Database.initialize();assert.equal(api.Database.repo('settings').all().length,n);
  seed();api.Database.initialize();assert.equal(api.Database.repo('students').all().length,3);
  state.sheets.get('students').rows[0][0]='incorrect';assert.throws(()=>api.Database.initialize(),e=>e.code==='SCHEMA');
});

test('repository grows past initial 1000-row grid without losing prior records',()=>{
  const repo=api.Database.repo('mutations');
  repo.appendMany(Array.from({length:1100},(_,i)=>({mutationId:'entry-'+i,userId:'admin',action:'test',payloadHash:'hash',resultJson:'{}',createdAt:new Date().toISOString()})));
  assert.equal(repo.all().length,1100);assert.ok(state.sheets.get('mutations').getMaxRows()>=1101);assert.equal(repo.all()[0].mutationId,'entry-0');
});

test('setup/recovery rejects anonymous callers; random temporary admin is log-only',()=>{
  state.activeEmail='';assert.throws(()=>api.setupSystem(),e=>e.code==='FORBIDDEN');assert.throws(()=>api.resetAdminPassword(),e=>e.code==='FORBIDDEN');
  state.activeEmail=state.effectiveEmail;const r=api.setupSystem();assert.equal(r.createdAdmin,true);assert.equal(JSON.stringify(r).includes('รหัสผ่านชั่วคราว'),false);
  const u=api.Database.repo('users').all()[0];assert.equal(u.mustChangePassword,true);assert.equal(u.username,'admin');assert.equal(state.logs.some(s=>s.includes('รหัสผ่านชั่วคราว:')),true);assert.equal(api.setupSystem().createdAdmin,false);
});

test('email password reset verifies the registered username and email',()=>{
  const {admin}=seed();
  api.AdminService.saveUser(admin,{userId:admin.userId,username:'admin',displayName:'ผู้ดูแล',role:'admin',classroomIds:[],active:true,email:'admin@example.com'},'request-email');
  const sent=api.PasswordResetService.request({username:'admin',email:'admin@example.com'},'reset-request');
  assert.equal(sent.requested,true);assert.equal(sent.matched,true);assert.equal(state.mail.to,'admin@example.com');
  const token=state.mail.body.match(/\n([a-f0-9]{64})\n/)[1];
  assert.equal(api.PasswordResetService.reset({token,newPassword:'New-secure-pass-12'},'reset-complete').reset,true);
  assert.equal(api.AuthService.login({username:'admin',password:'New-secure-pass-12'},'login-after-reset').user.username,'admin');
  const missing=api.PasswordResetService.request({username:'missing',email:'admin@example.com'},'unknown-reset');
  assert.equal(missing.requested,true);assert.equal(missing.matched,false);assert.equal(state.mail.to,'admin@example.com');
});
test('student import rejects duplicate IDs before writing any row',()=>{
  const {admin}=seed();api.Database.repo('classrooms').append({classroomId:'m1-1',name:'ม.1/1',active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const before=api.Database.repo('students').all().length;
  assert.throws(()=>api.AdminService.importStudents(admin,{rows:[{studentId:'00001',firstName:'หนึ่ง',lastName:'ทดสอบ',classroomId:'m1-1',number:1},{studentId:'00001',firstName:'สอง',lastName:'ทดสอบ',classroomId:'m1-1',number:2}]},'import-duplicate'),e=>e.code==='CONFLICT');
  assert.equal(api.Database.repo('students').all().length,before);
  const result=api.AdminService.importStudents(admin,{rows:[{studentId:'90001',firstName:'หนึ่ง',lastName:'ทดสอบ',classroomId:'m1-1',number:1}]},'import-ok');
  assert.equal(result.imported,1);
});

test('public/domain database sharing blocks setup before sheets or credentials are created',()=>{
  state.sheets.clear();api.Database.instance=null;
  for(const access of ['ANYONE','ANYONE_WITH_LINK','DOMAIN','DOMAIN_WITH_LINK']){
    state.sharingAccess=access;
    assert.throws(()=>api.setupSystem(),e=>e.code==='PRIVATE_DATABASE_REQUIRED');
    assert.equal(state.sheets.size,0);assert.equal(state.logs.some(s=>s.includes('รหัสผ่านชั่วคราว:')),false);
  }
  state.sharingAccess='PRIVATE';assert.equal(api.setupSystem().initialized,true);
});

test('a database re-shared later denies bootstrap/login/data/recovery/notifications without writes',()=>{
  seed();const auth=login();
  const sessions=api.Database.repo('sessions').all().length,logs=api.Database.repo('logs').all().length;
  state.sharingAccess='ANYONE_WITH_LINK';
  for(const action of ['bootstrap','login','listStudents','saveAttendance','exportPdf']){
    const r=api.dispatch({action,token:auth.token,payload:{username:'admin',password:fixturePassword}});
    assert.equal(r.ok,false);assert.equal(r.error.code,'PRIVATE_DATABASE_REQUIRED');
  }
  assert.throws(()=>api.resetAdminPassword(),e=>e.code==='PRIVATE_DATABASE_REQUIRED');
  assert.throws(()=>api.NotificationService.tick(),e=>e.code==='PRIVATE_DATABASE_REQUIRED');
  assert.equal(api.Database.repo('sessions').all().length,sessions);assert.equal(api.Database.repo('logs').all().length,logs);assert.equal(state.fetches.length,0);
});

test('auth hashes sessions, enforces initial reset, revokes logout and denies anonymous APIs',()=>{
  const {teacher}=seed();teacher.mustChangePassword=true;api.Database.repo('users').update(teacher);
  const auth=login();assert.equal(auth.mustChangePassword,true);const s=api.Database.repo('sessions').all()[0];assert.notEqual(s.tokenHash,auth.token);assert.equal(s.tokenHash,api.PasswordCrypto.hash(auth.token));
  assert.equal(api.dispatch({action:'listStudents',payload:{},token:auth.token}).error.code,'PASSWORD_CHANGE_REQUIRED');assert.equal(api.dispatch({action:'listStudents',payload:{}}).error.code,'UNAUTHORIZED');
  const changed=api.dispatch({action:'changePassword',token:auth.token,payload:{currentPassword:fixturePassword,newPassword:'An-even-better-pass!'}});assert.equal(changed.ok,true);assert.equal(changed.data.user.mustChangePassword,false);
  assert.equal(api.dispatch({action:'listStudents',payload:{},token:auth.token}).data.length,2);
  assert.equal(api.dispatch({action:'logout',payload:{},token:auth.token}).ok,true);assert.equal(api.dispatch({action:'listStudents',payload:{},token:auth.token}).error.code,'UNAUTHORIZED');
});

test('advisor ACL covers list/statistics/attendance/admin APIs and reads current active user',()=>{
  const {teacher}=seed(),auth=login();assert.deepEqual(plain(api.AdminService.students(teacher,{})).map(s=>s.studentId),['00001','00002']);
  const rooms=api.AdminService.classrooms(teacher);assert.equal(rooms.length,1);assert.equal(rooms[0].advisorName,'ครู เอ');
  for(const action of ['getAttendance','statistics'])assert.equal(api.dispatch({action,token:auth.token,payload:{classroomId:'B',date:api.today_()}}).error.code,'FORBIDDEN');
  for(const action of ['getSettings','saveSettings','listUsers','saveUser','saveStudent','saveClassroom','getLogs'])assert.equal(api.dispatch({action,token:auth.token,payload:{}}).error.code,'FORBIDDEN');
  assert.equal(api.ReportService.statistics(teacher,{date:api.today_(),studentId:'00003'}).summary.total,0);
  teacher.active=false;api.Database.repo('users').update(teacher);assert.equal(api.dispatch({action:'listStudents',token:auth.token,payload:{}}).error.code,'UNAUTHORIZED');
});

test('settings are restricted to the super administrator role',()=>{
  const {admin}=seed(), advisor=api.Database.repo('users').find('userId','advisor-a');
  assert.throws(()=>api.SettingsService.get(advisor),e=>e.code==='FORBIDDEN');
  const superAdmin={...admin,role:'super_admin'};
  assert.equal(api.SettingsService.get(superAdmin).schoolName,'โรงเรียนตากใบ');
});

test('mutations dedupe retry, preserve reasons, reject stale revisions, retain clear audit',()=>{
  const {teacher}=seed(),date=api.today_();assert.equal(api.AttendanceService.get(teacher,{date,classroomId:'A'}).summary.unmarked,2);
  const p=mutation([{studentId:'00001',status:'leave',reason:'ไปพบแพทย์'},{studentId:'00002',status:'present',reason:''}]);
  const first=api.AttendanceService.mutate(teacher,p,'r1',false);assert.equal(first.revision,1);assert.equal(first.locationRecorded,false);
  const retry=api.AttendanceService.mutate(teacher,p,'r2',false);assert.equal(retry.deduplicated,true);assert.equal(retry.revision,1);assert.equal(api.Database.repo('attendance').all().length,2);assert.equal(api.Database.repo('mutations').all().length,1);
  const logs=api.Database.repo('logs').all().filter(l=>l.action==='save_attendance');assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0].afterJson)[0].reason,'ไปพบแพทย์');assert.equal(JSON.parse(logs[0].locationJson).locationError,'ผู้ใช้ไม่อนุญาตตำแหน่ง');
  assert.throws(()=>api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'late',reason:''}]),'r3',false),e=>e.code==='CONFLICT'&&e.details.revision===1);
  assert.throws(()=>api.AttendanceService.mutate(teacher,{...p,records:[{studentId:'00001',status:'absent'}]},'reuse',false),e=>e.code==='CONFLICT');
  const update=mutation([{studentId:'00001',status:'late',reason:'รถเสีย'}],{baseRevision:1,location:{latitude:6.26,longitude:102.05,accuracy:15,capturedAt:new Date().toISOString()},locationError:''});assert.equal(api.AttendanceService.mutate(teacher,update,'r4',false).revision,2);
  const current=api.AttendanceService.get(teacher,{date,classroomId:'A'});assert.equal(current.records.find(r=>r.studentId==='00001').reason,'รถเสีย');assert.equal(current.summary.rate,62.5);
  const clear={...mutation([]),baseRevision:2};assert.equal(api.AttendanceService.mutate(teacher,clear,'clear',true).revision,3);assert.equal(api.Database.repo('attendance').all().length,0);assert.equal(api.AttendanceService.get(teacher,{date,classroomId:'A'}).summary.unmarked,2);
  assert.equal(JSON.parse(api.Database.repo('logs').all().find(l=>l.action==='clear_attendance').beforeJson).length,2);
});

test('invalid batch validates fully before writes, preserves leading zeros and validates location',()=>{
  const {teacher}=seed();assert.throws(()=>api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'present'},{studentId:'00003',status:'absent'}]),'',false),e=>e.code==='FORBIDDEN');assert.equal(api.Database.repo('attendance').all().length,0);
  assert.throws(()=>api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'present'},{studentId:'00001',status:'present'}]),'',false),e=>e.code==='VALIDATION');
  assert.throws(()=>api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'present'}],{location:{latitude:200,longitude:100,accuracy:10}}),'',false),e=>e.code==='VALIDATION');
  api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'present'}]),'',false);assert.equal(api.Database.repo('attendance').all()[0].studentId,'00001');
});

test('monthly denominator uses recorded days before student filter; unmarked differs from absent',()=>{
  const {teacher}=seed(),date=api.today_(),month=date.slice(0,7);const empty=api.ReportService.statistics(teacher,{month});assert.equal(empty.summary.total,0);assert.equal(empty.summary.dateCount,0);
  api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'absent',reason:'ไม่แจ้ง'}]),'',false);
  const report=api.ReportService.statistics(teacher,{month});assert.equal(report.summary.dateCount,1);assert.equal(report.summary.total,2);assert.equal(report.summary.absent,1);assert.equal(report.summary.unmarked,1);
  const other=api.ReportService.statistics(teacher,{month,studentId:'00002'});assert.equal(other.summary.dateCount,1);assert.equal(other.summary.total,1);assert.equal(other.summary.unmarked,1);assert.equal(other.records.length,0);assert.equal(report.denominatorNote.includes('เฉพาะวันที่มีการบันทึก'),true);
  assert.throws(()=>api.ReportService.statistics(teacher,{date:'2026-02-30'}),e=>e.code==='VALIDATION');assert.throws(()=>api.ReportService.statistics(teacher,{dateFrom:'2020-01-01',dateTo:'2026-01-01'}),e=>e.code==='VALIDATION');
});

test('Bangkok log filters include local midnight despite previous UTC date',()=>{
  const {admin}=seed();api.Database.repo('logs').append({logId:'local-midnight',timestamp:'2026-09-30T18:00:00.000Z',actorId:admin.userId,actorName:admin.displayName,action:'save_attendance',entityId:'A',beforeJson:'null',afterJson:'{}',locationJson:'null',requestId:''});
  assert.equal(api.AdminService.logs(admin,{dateFrom:'2026-10-01',dateTo:'2026-10-01'}).length,1);assert.equal(api.AdminService.logs(admin,{dateFrom:'2026-09-30',dateTo:'2026-09-30'}).length,0);
});

test('tokens never enter public settings/audit; notification opt-in triggers one aggregate send/day',()=>{
  const {admin}=seed(),secret='top-secret-line-access-token';api.SettingsService.save(admin,{lineToken:secret,lineTargetId:'U123',lineEnabled:true,reportTime:'00:00',dailyReportEnabled:false},'settings');
  assert.equal(state.properties.get('LINE_CHANNEL_ACCESS_TOKEN'),secret);assert.equal(state.triggers.length,0);assert.equal(JSON.stringify(api.SettingsService.get(admin)).includes(secret),false);assert.equal(api.SettingsService.get(admin).lineConfigured,true);assert.equal(JSON.stringify(api.SettingsService.publicSettings()).includes('lineTargetId'),false);assert.equal(JSON.stringify(api.Database.repo('logs').all()).includes(secret),false);
  api.NotificationService.tick();assert.equal(state.fetches.length,0);api.SettingsService.save(admin,{dailyReportEnabled:true},'enable');assert.equal(state.triggers.length,1);assert.equal(state.triggers[0].minutes,5);
  api.NotificationService.tick();api.NotificationService.tick();assert.equal(state.fetches.length,1);const sent=state.fetches[0];assert.equal(sent.url,'https://api.line.me/v2/bot/message/push');assert.equal(sent.options.headers.Authorization,'Bearer '+secret);assert.equal(sent.options.followRedirects,false);assert.equal(sent.options.payload.includes('สมชาย'),false);
  api.SettingsService.save(admin,{dailyReportEnabled:false},'disable');assert.equal(state.triggers.length,0);
  for(const url of ['http://example.org/hook','https://127.0.0.1/hook','https://localhost/hook','https://host.internal/hook','https://example.org:8443/hook','https://user:pass@example.org/hook'])assert.throws(()=>api.NotificationService.validateWebhook(url));
  assert.equal(api.NotificationService.validateWebhook('https://hooks.school.ac.th/attendance'),'https://hooks.school.ac.th/attendance');
});

test('last admin is retained, formula text is escaped, user API never includes password material',()=>{
  const {admin}=seed();assert.throws(()=>api.AdminService.saveUser(admin,{userId:admin.userId,username:'admin',displayName:'Admin',role:'advisor',classroomIds:[],active:true},''),e=>e.code==='VALIDATION');
  api.AdminService.saveStudent(admin,{studentId:'00004',prefix:'',firstName:'=IMPORTXML("x")',lastName:'ปลอดภัย',classroomId:'A',number:4,active:true},'');assert.equal(state.sheets.get('students').rows.at(-1)[2].startsWith("'="),true);
  const auth=login('admin'),users=api.dispatch({action:'listUsers',token:auth.token,payload:{}}).data;assert.equal(JSON.stringify(users).includes(fixtureHash),false);assert.equal(JSON.stringify(users).includes(fixtureSalt),false);
});

test('legacy user schema gains password column without overwriting hashes or rows',()=>{
  seed();const sheet=state.sheets.get('users');sheet.rows.forEach(row=>row.pop());
  const before=sheet.rows.map(row=>row.slice());const repo=api.Database.repo('users');
  assert.equal(sheet.rows[0][12],'password');assert.deepEqual(sheet.rows.slice(1).map(row=>row.slice(0,12)),before.slice(1));
  assert.equal(api.PasswordCrypto.verify(fixturePassword,repo.find('userId','admin-1')),true);
  api.Database.initialize();assert.equal(repo.all().length,3);
});
test('password changes store readable eight-digit password, preserve zero, and revoke other sessions',()=>{
  seed();const first=login('admin'),second=login('admin');const actor=api.AuthService.authenticate(first.token,true);
  api.AuthService.changePassword(actor,{currentPassword:fixturePassword,newPassword:'01234567'},'change');
  const user=api.Database.repo('users').find('userId','admin-1');assert.equal(user.password,'01234567');assert.equal(user.passwordHash,'');
  assert.equal(api.AuthService.login({username:'admin',password:'01234567'},'new-login').user.username,'admin');
  assert.throws(()=>api.AuthService.login({username:'admin',password:fixturePassword},'old-login'),e=>e.code==='LOGIN_FAILED');
  assert.throws(()=>api.AuthService.authenticate(second.token,true),e=>e.code==='UNAUTHORIZED');
  assert.equal(JSON.stringify(api.AdminService.users(user)).includes('01234567'),false);
  assert.equal(JSON.stringify(state.sheets.get('logs').rows).includes('01234567'),false);
});

test('dashboard trend covers seven days without adding earlier counts to selected-day totals',()=>{
  const {teacher}=seed();const date=api.today_();
  const yesterday=new Date(new Date(date+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  api.AttendanceService.mutate(teacher,mutation([{studentId:'00001',status:'present',reason:''}],{date:yesterday}),'prior',false);
  api.AttendanceService.mutate(teacher,mutation([{studentId:'00002',status:'leave',reason:''}]),'current',false);
  const data=api.dispatch({action:'dashboard',token:login().token,payload:{date}});
  assert.equal(data.ok,true);assert.equal(data.data.daily.length,7);assert.equal(data.data.summary.present,0);assert.equal(data.data.summary.leave,1);assert.equal(data.data.summary.total,2);assert.equal(data.data.summary.dateCount,1);
  assert.equal(data.data.daily.find(day=>day.date===yesterday).present,1);
  assert.equal(data.data.records.length,1);assert.equal(data.data.byClassroom[0].present,0);
  assert.equal(data.data.daily[0].hasData,false);
});
test('public dashboard includes active student count before the first check without disclosing private records',()=>{
  seed();const result=api.dispatch({action:'publicDashboard',payload:{date:api.today_()}});
  assert.equal(result.ok,true);assert.equal(result.data.summary.total,3);assert.equal(result.data.summary.unmarked,3);assert.equal(result.data.daily.length,7);
  const text=JSON.stringify(result.data);for(const key of ['password','studentId','username','latitude','fullName'])assert.equal(text.includes(key),false);
});
