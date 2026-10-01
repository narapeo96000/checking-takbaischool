import {uuid, today, summarize} from './core.js';

export class ApiError extends Error {constructor(message,code='API_ERROR',details=null){super(message);this.code=code;this.details=details;}}
export function validateApiUrl(value){const u=new URL(value);if(u.origin!=='https://script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(u.pathname)||u.search||u.hash)throw new Error('กรุณาใส่ URL เว็บแอป Google Apps Script ที่ลงท้าย /exec');return u.href;}
export class AppsScriptApi {
  constructor(url){this.url=validateApiUrl(url);this.token='';this.pending=new Map();this.channel=uuid();this.source=null;this.origin=null;this.listener=this.receive.bind(this);window.addEventListener('message',this.listener);}
  async connect(){if(this.source)return; if(this.ready)return this.ready;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.readyTimer=setTimeout(()=>{this.ready=null;reject(new ApiError('เชื่อมต่อหลังบ้านไม่ได้ ตรวจ URL และสิทธิ์การเผยแพร่เว็บแอป','CONNECTION'));},25000);});
    const u=new URL(this.url);u.searchParams.set('channel',this.channel);u.searchParams.set('hostOrigin',location.origin);
    this.frame=document.createElement('iframe');this.frame.title='การเชื่อมต่อระบบเช็คชื่อ';this.frame.hidden=true;this.frame.referrerPolicy='no-referrer';this.frame.src=u.href;document.body.append(this.frame);return this.ready;
  }
  receive(event){const msg=event.data;
    if(!/^https:\/\/(?:[a-z0-9-]+\.)?googleusercontent\.com$/.test(event.origin)||!msg||msg.channel!==this.channel)return;
    if(msg.type==='CHECKING_READY'&&!this.source){this.source=event.source;this.origin=event.origin;clearTimeout(this.readyTimer);this.resolveReady?.();return;}
    if(event.source!==this.source||event.origin!==this.origin||msg.type!=='CHECKING_RESPONSE')return;
    const entry=this.pending.get(msg.requestId);if(!entry)return;clearTimeout(entry.timer);this.pending.delete(msg.requestId);
    const result=msg.response||msg.result;if(result?.ok)entry.resolve(result.data);else entry.reject(new ApiError(result?.error?.message||'ระบบไม่สามารถดำเนินการได้',result?.error?.code,result?.error?.details));
  }
  async call(action,payload={}){await this.connect();const requestId=uuid();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new ApiError('ยังไม่ได้รับคำยืนยันจากเซิร์ฟเวอร์ กรุณาลองซิงก์อีกครั้ง','TIMEOUT'));},60000);this.pending.set(requestId,{resolve,reject,timer});this.source.postMessage({type:'CHECKING_REQUEST',channel:this.channel,requestId,request:{action,payload,token:this.token,requestId}},this.origin);});}
  dispose(){window.removeEventListener('message',this.listener);clearTimeout(this.readyTimer);this.frame?.remove();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ApiError('การเชื่อมต่อถูกปิด'));}this.pending.clear();this.token='';}
}

/** Explicit sample mode; this service never writes to Google Sheets. */
export class DemoApi {
  constructor(){this.token='demo';this.settings={schoolName:'โรงเรียนตากใบ',affiliation:'ตัวอย่างข้อมูลสำหรับทดลองใช้งาน',primaryColor:'#a5262c',secondaryColor:'#795548',reportTime:'08:10',notificationsEnabled:false};this.user={id:'demo-admin',name:'ผู้ดูแลระบบตัวอย่าง',role:'admin',username:'demo'};this.classrooms=Array.from({length:6},(_,i)=>({id:`room-${i+1}`,name:`ม.${Math.floor(i/2)+1}/${i%2+1}`,advisorId:`teacher-${i%3+1}`,advisorName:['ครูอารีย์','ครูสมชาย','ครูรัตนา'][i%3]}));const names=['อามีนา','ธนกฤต','สุภาวดี','อัฟฟาน','ปิยธิดา','มูฮัมหมัด','ณัฐวุฒิ','ฟารีดา','กัญญารัตน์','อัซมี','พงศกร','นูรอัยนี'];this.students=this.classrooms.flatMap(room=>names.map((name,i)=>({id:`${room.id}-${i+1}`,studentId:`${room.id.slice(5)}${String(i+1).padStart(4,'0')}`,name:`${name} นักเรียนตัวอย่าง`,number:i+1,classroomId:room.id,classroomName:room.name,advisorId:room.advisorId,advisorName:room.advisorName,active:true})));this.rows=[];this.mutations=new Set();for(const student of this.students){if(student.number>10)continue;this.rows.push({date:today(),classroomId:student.classroomId,studentId:student.id,status:student.number===8?'absent':student.number===9?'late':student.number===10?'leave':'present',reason:'',updatedAt:new Date().toISOString()});}}
  async call(action,p={}){switch(action){
    case 'bootstrap':return {settings:this.settings,today:today(),version:'1.0.0'};
    case 'login':return {token:'demo',user:this.user,mustChangePassword:false};
    case 'logout':return {};
    case 'listClassrooms':return this.classrooms;
    case 'listStudents':return this.students.filter(s=>(!p.classroomId||s.classroomId===p.classroomId)&&(!p.advisorId||s.advisorId===p.advisorId)&&(!p.search||`${s.name} ${s.studentId}`.includes(p.search)));
    case 'getAttendance':{const students=this.students.filter(s=>s.classroomId===p.classroomId);const records=this.rows.filter(r=>r.classroomId===p.classroomId&&r.date===p.date);return {date:p.date,classroomId:p.classroomId,students,records,summary:summarize(records,students.length)};}
    case 'saveAttendance':case 'clearAttendance':{if(this.mutations.has(p.mutationId))return {saved:true};if(action==='clearAttendance')this.rows=this.rows.filter(r=>!(r.date===p.date&&r.classroomId===p.classroomId));else for(const record of p.records){const existing=this.rows.find(r=>r.date===p.date&&r.studentId===record.studentId);if(existing)Object.assign(existing,record,{updatedAt:new Date().toISOString()});else this.rows.push({...record,date:p.date,classroomId:p.classroomId,updatedAt:new Date().toISOString()});}this.mutations.add(p.mutationId);return {saved:true};}
    case 'dashboard':case 'statistics':return this.stats(p);
    case 'getSettings':return {...this.settings};
    case 'saveSettings':Object.assign(this.settings,p);return this.settings;
    case 'listUsers':return [this.user];
    case 'saveStudent':{let s=this.students.find(s=>s.id===p.id);if(s)Object.assign(s,p);else {s={...p,id:uuid()};this.students.push(s);}const room=this.classrooms.find(r=>r.id===s.classroomId);Object.assign(s,{classroomName:room?.name,advisorId:room?.advisorId,advisorName:room?.advisorName});return s;}
    case 'saveClassroom':{let r=this.classrooms.find(r=>r.id===p.id);if(r)Object.assign(r,p);else {r={...p,id:uuid()};this.classrooms.push(r);}return r;}
    case 'saveUser':return p;
    case 'getLogs':return this.rows.map((r,i)=>({...r,id:i,actorName:'ผู้ดูแลระบบตัวอย่าง',action:'saveAttendance'}));
    case 'changePassword':return {success:true};
    case 'exportPdf':throw new ApiError('รายงาน PDF จริงสร้างจาก Google Apps Script กรุณาเชื่อมต่อหลังบ้านก่อน หรือใช้พิมพ์เป็น PDF สำหรับข้อมูลตัวอย่าง','DEMO_PDF');
    default:throw new ApiError('ไม่รู้จักคำสั่ง');
  }}
  stats(p){const dates=p.month?[`${p.month}-01`,`${p.month}-31`]:[p.dateFrom||p.date||today(),p.dateTo||p.date||today()];const students=this.students.filter(s=>(!p.classroomId||s.classroomId===p.classroomId)&&(!p.advisorId||s.advisorId===p.advisorId)&&(!p.studentId||s.studentId===p.studentId));const allowed=new Set(students.map(s=>s.id));const records=this.rows.filter(r=>allowed.has(r.studentId)&&r.date>=dates[0]&&r.date<=dates[1]).map(r=>({...this.students.find(s=>s.id===r.studentId),...r})).filter(r=>!p.search||`${r.name} ${r.studentId} ${r.reason}`.includes(p.search));const dayKeys=[...new Set(records.map(r=>r.date))];const daily=dayKeys.map(date=>({date,...summarize(records.filter(r=>r.date===date),students.length)}));const byClassroom=this.classrooms.filter(c=>!p.classroomId||p.classroomId===c.id).map(c=>({...c,classroomId:c.id,classroomName:c.name,...summarize(records.filter(r=>r.classroomId===c.id),students.filter(s=>s.classroomId===c.id).length),checked:records.filter(r=>r.classroomId===c.id).length}));return {summary:summarize(records,students.length*Math.max(dayKeys.length,1)),records,daily,byClassroom,range:{dateFrom:dates[0],dateTo:dates[1]}};}
  dispose(){}
}
