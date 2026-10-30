/** Feature-based helpers for mobile browsers; no user-agent detection. */
export class SafeStorage {
  constructor(getStorage=()=>globalThis.localStorage){
    this.memory=new Map();this.backend=null;this.persistent=false;
    try{this.backend=getStorage();const key='checking:storage-probe';this.backend.setItem(key,'1');this.backend.removeItem(key);this.persistent=true;}catch{this.backend=null;}
  }
  getItem(key){try{if(this.backend)return this.backend.getItem(key);}catch{this.backend=null;this.persistent=false;}return this.memory.get(key)??null;}
  setItem(key,value){this.memory.set(key,String(value));try{this.backend?.setItem(key,String(value));}catch{this.backend=null;this.persistent=false;}}
  removeItem(key){this.memory.delete(key);try{this.backend?.removeItem(key);}catch{this.backend=null;this.persistent=false;}}
}
export const touchNavigation=()=>typeof matchMedia==='function'&&matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)').matches;

export function pickSpreadsheetFile(doc=document){
  return new Promise((resolve,reject)=>{
    const input=doc.createElement('input'),cancel=doc.createElement('button');input.type='file';input.accept='.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';input.tabIndex=-1;input.setAttribute('aria-hidden','true');input.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none';
    cancel.type='button';cancel.className='button button-secondary file-picker-cancel';cancel.textContent='ยกเลิกการเลือกไฟล์';
    let finished=false;
    const cleanup=()=>{input.remove();cancel.remove();};
    const finish=file=>{if(finished)return;finished=true;cleanup();resolve(file);};
    // A cloud provider may deliver change long after focus returns. Only explicit
    // cancel/change signals finish this operation; focus is never a cancellation.
    input.addEventListener('change',()=>finish(input.files?.[0]||null),{once:true});input.addEventListener('cancel',()=>finish(null),{once:true});cancel.addEventListener('click',()=>finish(null),{once:true});
    try{doc.body.append(input,cancel);input.click();}catch(error){cleanup();reject(error);}
  });
}
export function readFileBytes(file){
  if(typeof file.arrayBuffer==='function')return file.arrayBuffer();
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์จากในเครื่องอีกครั้ง'));reader.readAsArrayBuffer(file);});
}
export function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.target='_blank';link.rel='noopener';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function mountDownloadLink(url,filename,container,onClose){
  const panel=document.createElement('section');panel.className='card pdf-fallback';panel.setAttribute('aria-label','ดาวน์โหลด PDF');
  const title=document.createElement('h2');title.textContent='รายงาน PDF พร้อมแล้ว';
  const link=document.createElement('a');link.href=url;link.download=filename;link.target='_blank';link.rel='noopener';link.className='button button-primary pdf-download';link.textContent='ดาวน์โหลด PDF';
  const label=document.createElement('p');label.className='pdf-filename';label.textContent=filename;
  const button=document.createElement('button');button.type='button';button.className='button button-secondary';button.textContent='ปิด';
  let closed=false;const close=()=>{if(closed)return;closed=true;panel.remove();onClose();};
  button.addEventListener('click',close);link.addEventListener('click',()=>setTimeout(close,0),{once:true});panel.append(title,link,label,button);container.prepend(panel);panel.scrollIntoView?.({block:'nearest'});link.focus?.();return close;
}
