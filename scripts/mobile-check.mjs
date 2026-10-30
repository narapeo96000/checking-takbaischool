/** Browser regression checks with synthetic data; never connects to the school database.
 * Install Playwright separately or set PLAYWRIGHT_MODULE to its absolute module path.
 */
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const origin='https://checking-mobile.test';
const css=readFileSync(path.join(root,'assets/styles.css'),'utf8');
const libraries=await Promise.all(['https://cdn.jsdelivr.net/npm/sweetalert2@11.26.25/dist/sweetalert2.all.min.js','https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'].map(async url=>{const result=await fetch(url);assert.ok(result.ok);return result.text();}));
const sizes=[[320,568],[360,800],[390,844],[844,390],[768,1024],[1024,768],[1280,900]];
const routes=['dashboard','login','attendance','students','statistics','teachers','settings','guide'];
const report={engines:[],layouts:0,failures:[]};
mkdirSync(path.join(root,'artifacts/mobile'),{recursive:true});
async function fixture(browser,width,height,{restricted=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width!==1280,hasTouch:width!==1280,acceptDownloads:true});
 await context.route(origin+'/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="th"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><body><div id="app"></div><div id="toast"></div></body></html>'});
  const filename=path.join(root,pathname.slice(1));
  let body=readFileSync(filename);
  if(pathname==='/assets/app.js')body=Buffer.from(body.toString().replace("if(typeof document!=='undefined')new AttendanceApp().start();",''));
  await route.fulfill({contentType:pathname.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/javascript; charset=utf-8',body});
 });
 await context.route('https://www.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Map fixture</p>'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.addStyleTag({content:css});for(const content of libraries)await page.addScriptTag({content});
 await page.evaluate(async restricted=>{
  if(restricted)Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('restricted storage');}});
  const {AttendanceApp}=await import('/assets/app.js'),{DemoApi}=await import('/assets/api.js'),{DraftQueue,today}=await import('/assets/core.js');
  window.mobileApp=new AttendanceApp();mobileApp.api=new DemoApi();window.mobileUser=mobileApp.api.user;
  mobileApp.queue=new DraftQueue(mobileApp.storage,'qa-mobile','demo');
  Object.assign(mobileApp.state,{user:mobileUser,settings:{...mobileApp.state.settings,...mobileApp.api.settings},demo:true,connection:'demo',students:mobileApp.api.students,classrooms:mobileApp.api.classrooms,rosterClassrooms:mobileApp.api.classrooms,users:[{...mobileUser,email:'example@school.test'}],loading:false});
  mobileApp.state.attendance={...await mobileApp.api.call('getAttendance',{date:today(),classroomId:'room-1'}),classroomId:'room-1',loadedKey:today()+':room-1',search:''};
  mobileApp.state.dashboard=await mobileApp.api.call('dashboard',{date:today()});mobileApp.state.stats=mobileApp.state.dashboard;
  mobileApp.render();
 },restricted);
 return {context,page,errors};
}
async function dismiss(page){await page.evaluate(()=>Swal.close());await page.waitForFunction(()=>!document.querySelector('.swal2-container'));}
for(const name of (process.env.MOBILE_ENGINES||'chromium,webkit').split(',')){
 const browser=await pw[name].launch({headless:true,...(name==='chromium'&&process.env.CHROMIUM_CHANNEL?{channel:process.env.CHROMIUM_CHANNEL}:{})});
 try{
  for(const [width,height] of sizes){
   const {context,page,errors}=await fixture(browser,width,height);
   for(const route of routes){
    await page.evaluate(route=>{mobileApp.state.route=route;mobileApp.state.user=route==='login'?null:mobileUser;mobileApp.render();},route);
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,smallInputs:[...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea')].filter(el=>el.getBoundingClientRect().width>0&&parseFloat(getComputedStyle(el).fontSize)<16).map(el=>el.id||el.name),menu:getComputedStyle(document.querySelector('.mobile-menu')).display}));
    report.layouts++;
    if(layout.overflow||layout.smallInputs.length||(width!==1280&&layout.menu==='none'))report.failures.push({engine:name,width,height,route,...layout});
    if(width===390&&['login','attendance'].includes(route))await page.screenshot({path:path.join(root,`artifacts/mobile/${name}-${route}.png`),fullPage:true});
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  if(report.failures.length){console.log(JSON.stringify(report.failures));throw new Error('Mobile layouts failed');}
  const {context,page,errors}=await fixture(browser,390,844);
  await page.locator('.mobile-menu').tap();assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'true');
  await page.locator('#sidebar-menu a[href="#students"]').tap();await page.waitForSelector('.roster-room');await page.waitForFunction(()=>!document.querySelector('.swal2-container'));
  assert.equal(await page.locator('.roster-room[open]').count(),0);await page.locator('.roster-room-heading').first().tap();assert.equal(await page.locator('.roster-room-table').first().isVisible(),true);
  await page.evaluate(()=>mobileApp.navigate('attendance'));await page.waitForFunction(()=>!document.querySelector('.swal2-container'));
  await page.locator('.status-button-absent').first().tap();await page.waitForFunction(()=>mobileApp.queue.items.length===0&&mobileApp.state.saveState==='saved');await dismiss(page);
  await page.evaluate(()=>{window.realCall=mobileApp.api.call.bind(mobileApp.api);window.offline=true;mobileApp.api.call=(action,payload)=>action==='saveAttendance'&&offline?Promise.reject(new Error('offline test')):realCall(action,payload);});
  await page.locator('.status-button-leave').first().tap();await page.waitForFunction(()=>mobileApp.queue.items.length===1&&mobileApp.state.saveState==='offline');await dismiss(page);
  await page.evaluate(async()=>{offline=false;await mobileApp.sync();});assert.equal(await page.evaluate(()=>mobileApp.queue.items.length),0);await dismiss(page);
  await page.evaluate(()=>mobileApp.navigate('guide'));await page.locator('#guide-search').fill('รหัสผ่าน');assert.ok(await page.locator('mark.guide-highlight').count()>0);assert.equal(await page.evaluate(()=>document.activeElement.id),'guide-search');
  await page.evaluate(async()=>{mobileApp.state.user=null;mobileApp.state.demo=false;await mobileApp.navigate('login');Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(resolve){window.geoDone=resolve;}}});mobileApp.state.location={status:'idle'};window.gps=mobileApp.captureLocation(false);});
  await page.locator('#login-form [name="username"]').fill('teacher@example.test');await page.locator('#login-form [name="password"]').fill('test12345');
  await page.evaluate(async()=>{geoDone({coords:{latitude:6.1,longitude:101.9,accuracy:15},timestamp:Date.now()});await gps;});assert.equal(await page.locator('#login-form [name="password"]').inputValue(),'test12345');assert.equal(await page.locator('#login-form [name="username"]').inputValue(),'teacher@example.test');
  await page.evaluate(async()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(resolve,reject){reject({code:1});}}});await mobileApp.captureLocation(false,true);});assert.equal(await page.evaluate(()=>mobileApp.state.location.status),'unavailable');
  await page.evaluate(async()=>{mobileApp.state.user=mobileUser;mobileApp.state.demo=true;await mobileApp.navigate('students');});await page.waitForFunction(()=>!document.querySelector('.swal2-container'));
  let chooserPromise=page.waitForEvent('filechooser');await page.locator('[data-action="import-students"]').tap();await (await chooserPromise).setFiles([]);await page.waitForFunction(()=>!document.querySelector('input[type="file"]'));
  const workbook=await page.evaluate(()=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{studentId:'90001',firstName:'ทดสอบ',lastName:'มือถือ',number:13,classroomId:'room-1'}]),'students');return [...new Uint8Array(XLSX.write(book,{bookType:'xlsx',type:'array'}))];});
  await page.evaluate(()=>{const previous=mobileApp.api.call.bind(mobileApp.api);mobileApp.api.call=async(action,payload)=>{if(action==='importStudents'){for(const row of payload.rows)mobileApp.api.students.push({...row,id:row.studentId,name:row.firstName+' '+row.lastName,active:true});return {imported:payload.rows.length};}return previous(action,payload);};});
  chooserPromise=page.waitForEvent('filechooser');await page.locator('[data-action="import-students"]').tap();await (await chooserPromise).setFiles({name:'mobile-import.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(workbook)});await page.waitForFunction(()=>document.querySelector('.swal2-title')?.textContent==='ยืนยันนำเข้าข้อมูล');await page.locator('.swal2-confirm').tap();await page.waitForFunction(()=>document.querySelector('.swal2-title')?.textContent.startsWith('นำเข้าสำเร็จ'));await dismiss(page);
  assert.equal(await page.evaluate(()=>mobileApp.state.students.some(s=>s.studentId==='90001')),true);
  await page.evaluate(()=>{mobileApp.state.demo=false;const previous=mobileApp.api.call.bind(mobileApp.api);mobileApp.api.call=(action,payload)=>action==='exportPdf'?Promise.resolve({base64:btoa('%PDF-1.4\nMobile test PDF\n%%EOF'),filename:'mobile-test.pdf'}):previous(action,payload);mobileApp.state.route='dashboard';mobileApp.render();});
  await page.locator('[data-action="export-pdf"]').tap();await page.waitForSelector('.pdf-download');const downloadPromise=page.waitForEvent('download');await page.locator('.pdf-download').tap();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'mobile-test.pdf');await download.saveAs(path.join(root,`artifacts/mobile/${name}-test.pdf`));await page.locator('.swal2-cancel').tap();
  await page.evaluate(()=>{window.oldSwal=window.Swal;delete window.Swal;window.fallbackExport=mobileApp.exportPdf();});await page.waitForSelector('.pdf-fallback .pdf-download');const fallbackDownload=page.waitForEvent('download');await page.locator('.pdf-fallback .pdf-download').tap();assert.equal((await fallbackDownload).suggestedFilename(),'mobile-test.pdf');await page.waitForFunction(()=>!document.querySelector('.pdf-fallback'));await page.evaluate(async()=>{await fallbackExport;window.Swal=oldSwal;});
  assert.deepEqual(errors,[]);await context.close();
  const restricted=await fixture(browser,390,844,{restricted:true});assert.equal(await restricted.page.evaluate(()=>mobileApp.storage.persistent),false);assert.ok(await restricted.page.getByText('เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลในเครื่อง').count());assert.deepEqual(restricted.errors,[]);await restricted.context.close();
  report.engines.push({engine:name,workflows:'drawer, roster, attendance, offline retry, search, late GPS, denied GPS, file cancel/import, PDF download, restricted storage'});console.log(JSON.stringify(report.engines.at(-1)));
 }finally{await browser.close();}
}
writeFileSync(path.join(root,'artifacts/mobile/report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({layouts:report.layouts,engines:report.engines.length,failures:report.failures.length}));
