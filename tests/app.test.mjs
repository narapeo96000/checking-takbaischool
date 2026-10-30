import test from 'node:test';
import assert from 'node:assert/strict';
import {AttendanceApp} from '../assets/app.js';
import {DraftQueue} from '../assets/core.js';
const storage=()=>({map:new Map(),getItem(k){return this.map.get(k)||null;},setItem(k,v){this.map.set(k,v);},removeItem(k){this.map.delete(k);}});
function app(){globalThis.document={addEventListener(){}};globalThis.window={addEventListener(){}};const a=new AttendanceApp();a.render=()=>{};a.beginActivity=()=>()=>{};a.toast=()=>{};a.updateSaveState=()=>{};a.state.user={id:'teacher',role:'advisor'};a.queue=new DraftQueue(storage(),'teacher');a.state.attendance={date:'2026-10-01',classroomId:'c1',loadedKey:'2026-10-01:c1',revision:3,students:[{id:'s1'},{id:'s2'}],records:[{studentId:'s1',status:'present',reason:''}],search:''};return a;}
test('failed reload clears old date data and prevents a new-date save',async()=>{const a=app();a.state.attendance.date='2026-10-02';a.api={call:async()=>{throw new Error('offline');}};await assert.rejects(a.loadAttendance());assert.deepEqual(a.state.attendance.records,[]);assert.equal(a.state.attendance.loadedKey,'');assert.throws(()=>a.enqueue('saveAttendance',[{studentId:'s1',status:'present'}]),/ยังโหลดข้อมูล/);});
test('an older room response cannot replace the currently chosen classroom',async()=>{const a=app();let finish;a.api={call:()=>new Promise(resolve=>finish=resolve)};const pending=a.loadAttendance();a.state.attendance.classroomId='c2';a.state.attendance.loadedKey='2026-10-01:c2';a.state.attendance.records=[{studentId:'s9',status:'late'}];finish({students:[{studentId:'s1'}],records:[{studentId:'s1',status:'absent'}],revision:7});await pending;assert.equal(a.state.attendance.records[0].studentId,'s9');assert.equal(a.state.attendance.loadedKey,'2026-10-01:c2');});
test('typing a reason then quickly marking another student retains the reason',async()=>{const a=app();a.sync=async()=>{};a.input({target:{dataset:{reasonId:'s1'},value:'ลาป่วย'}});await a.mark('s2','late');assert.equal(a.state.attendance.records.find(r=>r.studentId==='s1').reason,'ลาป่วย');assert.equal(a.queue.items[0].payload.records[0].reason,'ลาป่วย');assert.equal(a.queue.items.length,2);assert.equal(a.reasonTimers.size,0);});
test('in-flight acknowledgements only remove drafts from the original account',async()=>{const a=app();a.enqueue('saveAttendance',[{studentId:'s1',status:'present'}]);const original=a.queue;let finish;a.api={call:()=>new Promise(resolve=>finish=resolve)};const pending=a.sync();a.queue=new DraftQueue(storage(),'another-teacher');a.state.user=null;finish({revision:4});await pending;assert.equal(original.items.length,0);assert.equal(a.queue.items.length,0);assert.equal(a.syncing,false);});
test('audit dialog exposes coordinates from the backend location wrapper',async()=>{const a=app();a.api={call:async()=>[{timestamp:'2026-10-01T01:00:00Z',actorName:'ครู',action:'save_attendance',location:{location:{latitude:6.1234,longitude:100.9876,accuracy:17},locationError:''}}]};let captured;a.modal=async options=>{captured=options;return {};};await a.showLogs();assert.ok(captured.html.includes('6.1234, 100.9876'));assert.ok(captured.html.includes('17 เมตร'));});
test('public guide loads at its introduction without querying private data; protected pages still require login',async()=>{const a=app();a.state.user=null;globalThis.history={replaceState(){}};document.body={classList:{remove(){}}};let scrolledTo;document.getElementById=id=>({scrollIntoView(){scrolledTo=id;}});a.api={call:async()=>{throw new Error('Public help must not query backend');}};await a.navigate('guide');assert.equal(a.state.route,'guide');assert.equal(a.state.loading,false);assert.equal(scrolledTo,'guide-top');await a.navigate('guide-attendance');assert.equal(scrolledTo,'guide-attendance');await a.navigate('attendance');assert.equal(a.state.route,'login');});
test('public overview stays on home without login or private detail request',async()=>{const a=app();a.state.user=null;globalThis.history={replaceState(){}};document.body={classList:{remove(){}}};let requested; a.api={call:async(action)=>{requested=action;return {date:'2026-10-01',summary:{total:10,present:8,absent:1,late:1,leave:0,unmarked:0,rate:82.5},daily:[]};}};await a.navigate('dashboard');assert.equal(requested,'publicDashboard');assert.equal(a.state.route,'dashboard');assert.equal(a.state.user,null);});

test('one classroom request supplies schoolwide roster filters but only assigned attendance choices',async()=>{
  const a=app();a.state.attendance.classroomId='B';const requests=[];
  a.api={call:async(action,payload)=>{requests.push({action,payload});return action==='listClassrooms'?[{classroomId:'A',name:'ม.1/1',canCheckAttendance:true},{classroomId:'B',name:'ม.1/2',canCheckAttendance:false}]:[{studentId:'s3',classroomId:'B',firstName:'นักเรียน',lastName:'ห้องอื่น'}];}};
  await a.loadLists();assert.deepEqual(a.state.rosterClassrooms.map(room=>room.id),['A','B']);assert.deepEqual(a.state.classrooms.map(room=>room.id),['A']);assert.equal(a.state.attendance.classroomId,'A');assert.equal(a.state.students[0].classroomId,'B');assert.equal(requests.length,2);assert.equal(requests.find(request=>request.action==='listClassrooms').payload.scope,'roster');
  await a.loadLists();assert.equal(requests.length,2);
});

test('dashboard navigation crosses month/year boundaries and reuses public date cache',async()=>{
  const a=app();a.state.user=null;a.state.filters.date='2026-01-01';a.state.dashboard={date:'2026-01-01'};
  globalThis.history={replaceState(){}};document.body={classList:{remove(){}}};const calls=[];
  a.api={call:async(action,payload)=>{calls.push({action,date:payload.date});return {date:payload.date,summary:{},daily:[]};}};
  await a.stepDashboardDate(-1);assert.equal(a.state.dashboard.date,'2025-12-31');
  await a.stepDashboardDate(1);assert.equal(a.state.dashboard.date,'2026-01-01');
  await a.stepDashboardDate(-1);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.action==='publicDashboard'));assert.equal(a.state.route,'dashboard');
  a.state.loading=true;await a.stepDashboardDate(-1);assert.equal(a.state.filters.date,'2025-12-31');
  a.state.loading=false;await a.setDashboardDate('');await a.setDashboardDate('2026-02-30');assert.equal(calls.length,2);
});

function feedbackStub(a){
  const calls={fire:[],update:[],closed:0,visible:false};
  globalThis.Swal=window.Swal={fire(options){calls.fire.push(options);calls.visible=true;options.didOpen?.();return Promise.resolve({});},isVisible(){return calls.visible;},update(options){calls.update.push(options);},showLoading(){},close(){calls.closed++;calls.visible=false;}};
  a.beginActivity=AttendanceApp.prototype.beginActivity.bind(a);a.toast=AttendanceApp.prototype.toast.bind(a);return calls;
}
test('parallel requests share one live popup until all finish; long waits update and timers stop',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  const a=app(),feedback=feedbackStub(a);const finishes=[];a.api={call:()=>new Promise(resolve=>finishes.push(resolve))};
  const one=a.request('listClassrooms'),two=a.request('listStudents');assert.equal(feedback.fire.length,1);assert.equal(a.activityCount,2);
  t.mock.timers.tick(9000);assert.ok(feedback.update.at(-1).html.includes('ระบบยังทำงานอยู่'));assert.ok(feedback.update.at(-1).html.includes('9 วินาที'));
  finishes[0]([]);await one;t.mock.timers.tick(1000);assert.equal(feedback.closed,0);
  finishes[1]([]);await two;t.mock.timers.tick(150);assert.equal(feedback.closed,1);assert.equal(a.busyTimer,null);
  const updates=feedback.update.length;t.mock.timers.tick(30000);assert.equal(feedback.update.length,updates);delete globalThis.Swal;
});
test('progress stays open until success and pending cleanup cannot close a form or error',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  const a=app(),feedback=feedbackStub(a);a.toast('กำลังบันทึก…','info');t.mock.timers.tick(25000);
  assert.equal(feedback.closed,0);assert.ok(feedback.update.at(-1).html.includes('อย่ากดบันทึกซ้ำ'));
  a.api={call:async()=>({})};await a.request('saveAttendance');a.toast('บันทึกสำเร็จ','success');
  assert.equal(feedback.fire.at(-1).icon,'success');assert.equal(a.busyTimer,null);t.mock.timers.tick(1000);assert.equal(feedback.closed,0);
  a.toast('กำลังบันทึก…','info');a.toast('บันทึกสำเร็จ','success');assert.equal(feedback.fire.at(-1).icon,'success');assert.equal(a.busyTimer,null);
  await a.request('listStudents');await a.modal({title:'กรอกข้อมูล'});t.mock.timers.tick(1000);assert.equal(feedback.closed,0);assert.equal(feedback.fire.at(-1).title,'กรอกข้อมูล');
  a.api={call:async()=>{throw new Error('เครือข่ายขัดข้อง');}};await a.request('listStudents').catch(error=>a.error(error));
  assert.equal(feedback.fire.at(-1).icon,'error');assert.equal(a.busyTimer,null);t.mock.timers.tick(1000);assert.equal(feedback.closed,0);delete globalThis.Swal;
});

test('admin reset submits only target ID/new password; mismatched confirmation sends no request',async()=>{
  const a=app();a.state.user={id:'admin',role:'admin'};a.state.users=[{id:'teacher',name:'ครู',username:'teacher'}];const calls=[];a.api={call:async(action,payload)=>{calls.push({action,payload});return {reset:true};}};a.showStatusAlert=async()=>a.clearBusyFeedback();
  a.formModal=async()=>({newPassword:'12345678',confirmPassword:'87654321'});await a.adminResetPassword('teacher');assert.equal(calls.length,0);
  a.formModal=async()=>({newPassword:'01234567',confirmPassword:'01234567'});await a.adminResetPassword('teacher');assert.deepEqual(calls,[{action:'adminResetPassword',payload:{userId:'teacher',newPassword:'01234567'}}]);assert.equal(a.state.users[0].mustChangePassword,true);assert.equal(a.state.user.id,'admin');
  a.state.user.role='advisor';await assert.rejects(a.adminResetPassword('teacher'),/เฉพาะผู้ดูแล/);
});
test('email reset retries mismatched confirmation then consumes token without requiring login',async()=>{
  const a=app();a.state.user=null;const forms=[{newPassword:'12345678',confirmPassword:'87654321'},{newPassword:'01234567',confirmPassword:'01234567'}],calls=[];
  a.formModal=async()=>forms.shift();a.showStatusAlert=async()=>a.clearBusyFeedback();a.api={call:async(action,payload)=>{calls.push({action,payload});return {reset:true};}};a.navigate=async route=>{a.state.route=route;};globalThis.history={replaceState(){}};globalThis.location={pathname:'/'};
  await a.resetFromLink('a'.repeat(64));assert.deepEqual(calls,[{action:'resetPassword',payload:{token:'a'.repeat(64),newPassword:'01234567'}}]);assert.equal(a.state.route,'login');assert.equal(a.state.user,null);
});

test('a completed loading popup cannot hide confirmation on the next account form',async()=>{
 const a=app();let loading=0,oldOpen;globalThis.Swal=window.Swal={isVisible:()=>true,fire(options){if(options.didOpen)oldOpen=options.didOpen;return Promise.resolve({});},update(){},showLoading(){loading++;},getPopup:()=>({})};
 a.showBusyAlert('กำลังเรียกข้อมูล…');await a.modal({title:'บันทึกบัญชี'});oldOpen({});assert.equal(loading,0);assert.equal(a.busyTimer,null);delete globalThis.Swal;
});

test('restricted mobile storage does not prevent opening the application',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage access denied');}});
 try{assert.doesNotThrow(()=>app());}finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
test('a late location result preserves the current form instead of rebuilding it',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let resolvePosition;const a=app();let renders=0;a.render=()=>{renders++;};a.state.demo=false;a.state.location={status:'idle'};document.getElementById=()=>null;document.querySelector=()=>null;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(resolve){resolvePosition=resolve;}}}});
 try{const pending=a.captureLocation(false);resolvePosition({coords:{latitude:6,longitude:102,accuracy:12},timestamp:Date.now()});await pending;assert.equal(a.state.location.status,'ready');assert.equal(renders,0);}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});

test('successful roster writes refresh cached student results without reloading unrelated classrooms',async()=>{
 const a=app();let names=['เดิม'],roomCalls=0;a.api={call:async(action)=>{if(action==='listStudents')return names.map((name,i)=>({studentId:String(i),firstName:name}));if(action==='listClassrooms'){roomCalls++;return [];}if(action==='importStudents'){names.push('นำเข้าใหม่');return {imported:1};}return {};}};
 await a.cachedCall('listClassrooms',{},30000);assert.equal((await a.cachedCall('listStudents',{},30000)).length,1);await a.call('importStudents',{rows:[]});assert.equal((await a.cachedCall('listStudents',{},30000)).length,2);await a.cachedCall('listClassrooms',{},30000);assert.equal(roomCalls,1);
});

test('PDF waits for a real download tap and retains its blob URL until the dialog closes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const a=app();window.Swal={};a.state.demo=false;a.api={call:async()=>({base64:Buffer.from('%PDF-1.4 test').toString('base64'),filename:'<unsafe>.pdf'})};let dialog,close;const revoked=[];const original=URL.revokeObjectURL;URL.revokeObjectURL=url=>{revoked.push(url);original(url);};
 try{a.modal=options=>{dialog=options;return new Promise(resolve=>{close=resolve;});};const pending=a.exportPdf();for(let i=0;i<10&&!dialog;i++)await Promise.resolve();assert.ok(dialog.html.includes('class="button button-primary pdf-download"'));assert.ok(dialog.html.includes('download="&lt;unsafe&gt;.pdf"'));assert.ok(!dialog.html.includes('<unsafe>'));t.mock.timers.tick(120000);assert.equal(revoked.length,0);close({});await pending;t.mock.timers.tick(59999);assert.equal(revoked.length,0);t.mock.timers.tick(1);assert.equal(revoked.length,1);}finally{URL.revokeObjectURL=original;}
});

test('PDF remains downloadable through an actual page link when SweetAlert is unavailable',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const a=app();const panels=[];document.getElementById=()=>({prepend(node){panels.push(node);}});document.createElement=tag=>({tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},setAttribute(){},addEventListener(){},remove(){},focus(){},scrollIntoView(){}});window.confirm=()=>false;a.modal=AttendanceApp.prototype.modal.bind(a);a.state.demo=false;a.api={call:async()=>({base64:Buffer.from('%PDF-1.4 test').toString('base64'),filename:'test.pdf'})};await a.exportPdf();assert.equal(panels.length,1);assert.ok(panels[0].children.some(node=>node.tag==='a'&&node.download==='test.pdf'));a.closePdfFallback?.();
});
