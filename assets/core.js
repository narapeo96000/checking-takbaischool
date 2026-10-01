export const STATUSES = Object.freeze({present:'มา',absent:'ขาด',late:'สาย',leave:'ลา'});
let sweetAlertPromise;
let xlsxPromise;
const loadExternalScript = (url, globalName) => {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  const existing = document.querySelector(`script[data-library="${globalName}"]`);
  if (existing) return new Promise((resolve, reject) => { existing.addEventListener('load', () => resolve(window[globalName]), {once:true}); existing.addEventListener('error', () => reject(new Error(`โหลด ${globalName} ไม่สำเร็จ`)), {once:true}); });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url; script.async = true; script.dataset.library = globalName;
    script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`โหลด ${globalName} ไม่สำเร็จ`));
    script.onerror = () => reject(new Error(`โหลด ${globalName} ไม่สำเร็จ`));
    document.head.appendChild(script);
  });
};
export const loadSweetAlert = () => sweetAlertPromise ||= loadExternalScript('https://cdn.jsdelivr.net/npm/sweetalert2@11.26.25/dist/sweetalert2.all.min.js','Swal');
export const loadXlsx = () => xlsxPromise ||= loadExternalScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','XLSX');
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uuid = () => crypto.randomUUID();
export function safeUrl(value) { try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';} catch{return '';} }
export function summarize(records, total=records.length) {
  const result={total,present:0,absent:0,late:0,leave:0,unmarked:0,rate:0};
  for(const row of records) if(Object.hasOwn(STATUSES,row.status)) result[row.status]++;
  result.unmarked=Math.max(0,total-result.present-result.absent-result.late-result.leave);
  result.rate=total ? Math.round((result.present+result.late)/total*1000)/10 : 0;
  return result;
}
export function icon(name) {
  const shapes={
    book:'<path d="M12 5c-3-2-6-2-9-1v16c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v16"/>',
    check:'<path d="m5 12 4 4L19 6"/>', x:'<path d="m6 6 12 12M6 18 18 6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin:'<path d="m9 3 6 0-1 6 4 3H6l4-3-1-6M12 12v9"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9"/><circle cx="9" cy="7" r="4"/><path d="M16 3a4 4 0 0 1 0 8"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',chart:'<path d="M3 3v18h18M7 16v-5m5 5V7m5 9v-8"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
    search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>','chevron-right':'<path d="m9 5 7 7-7 7"/>','arrow-up':'<path d="M12 19V5m-6 6 6-6 6 6"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',settings:'<path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/>',
    'map-pin':'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17"/>',
    wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r=".7"/>',alert:'<path d="m12 3 10 18H2L12 3ZM12 9v4m0 4h.01"/>',login:'<path d="M14 3h7v18h-7M3 12h13m-5-5 5 5-5 5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5"/>',school:'<path d="m3 9 9-6 9 6v12H3V9Zm6 12v-7h6v7M6 10h1m10 0h1"/>',lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    'external-link':'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',home:'<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3V10Z"/>',logout:'<path d="M10 3H3v18h7M9 12h12m-5-5 5 5-5 5"/>'
  };
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||shapes.check}</svg>`;
}

/** Retains only unsent mutations for the same user; sessions are kept in memory. */
export class DraftQueue {
  constructor(storage,owner,namespace='live') {this.storage=storage;this.key=`checking:drafts:${namespace}:${owner}`;this.items=[];this.restore();}
  restore(){try {const saved=JSON.parse(this.storage.getItem(this.key)||'[]');this.items=Array.isArray(saved)?saved.filter(x=>x.createdAt>Date.now()-86400000&&x.payload?.mutationId):[];this.persist();}catch{this.items=[];}}
  persist(){if(this.items.length)this.storage.setItem(this.key,JSON.stringify(this.items));else this.storage.removeItem(this.key);}
  enqueue(action,payload){const item={action,payload:{...payload,mutationId:uuid()},createdAt:Date.now()};this.items.push(item);try{this.persist();}catch(error){this.items.pop();throw new Error('พื้นที่เก็บข้อมูลในเครื่องเต็ม กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนเช็คชื่อ');}return item;}
  remove(id){this.items=this.items.filter(x=>x.payload.mutationId!==id);this.persist();}
  matching(date,classroomId){return this.items.filter(x=>x.payload.date===date&&x.payload.classroomId===classroomId);}
  clear(){this.items=[];this.persist();}
}
