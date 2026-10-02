import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml,summarize,DraftQueue} from '../assets/core.js';
import {validateApiUrl,DemoApi} from '../assets/api.js';
import {Views} from '../assets/views.js';
class MemoryStorage {constructor(){this.map=new Map();}getItem(k){return this.map.get(k)||null;}setItem(k,v){this.map.set(k,v);}removeItem(k){this.map.delete(k);}}
test('unmarked students never silently counted absent; late included attendance rate',()=>{assert.deepEqual(summarize([{status:'present'},{status:'late'},{status:'leave'}],5),{total:5,present:1,absent:0,late:1,leave:1,unmarked:2,rate:40});});
test('queued retry preserves mutation id and is scoped to user',()=>{const storage=new MemoryStorage();const queue=new DraftQueue(storage,'teacher-one');const item=queue.enqueue('saveAttendance',{date:'2026-10-01',classroomId:'c1',records:[{studentId:'00001',status:'leave',reason:'ป่วย'}]});assert.equal(new DraftQueue(storage,'teacher-one').items[0].payload.mutationId,item.payload.mutationId);assert.equal(new DraftQueue(storage,'teacher-two').items.length,0);queue.remove(item.payload.mutationId);assert.equal(new DraftQueue(storage,'teacher-one').items.length,0);});
test('expired drafts are removed before reuse',()=>{const storage=new MemoryStorage();storage.setItem('checking:drafts:live:a',JSON.stringify([{createdAt:Date.now()-86400001,payload:{mutationId:'old'}}]));assert.equal(new DraftQueue(storage,'a').items.length,0);});
test('only published Apps Script exec URLs are accepted',()=>{assert.equal(validateApiUrl('https://script.google.com/macros/s/Abc_123/exec'),'https://script.google.com/macros/s/Abc_123/exec');for(const url of ['https://evil.test/macros/s/Abc/exec','https://script.google.com/macros/s/Abc/dev','https://script.google.com/macros/s/Abc/exec?token=secret','javascript:alert(1)'])assert.throws(()=>validateApiUrl(url));});
test('student names and reasons are escaped in attendance and statistics views',()=>{const state={user:{role:'admin'},settings:{},classrooms:[{id:'c',name:'ม.1/1'}],students:[{id:'s',studentId:'00001',name:'<script>alert(1)</script>',classroomId:'c',active:true}],attendance:{date:'2026-10-01',classroomId:'c',students:[],records:[{studentId:'s',status:'leave',reason:'<img onerror=alert(1)>'}]},stats:{summary:{},records:[{date:'2026-10-01',name:'<script>',reason:'<img>',status:'leave'}]},filters:{},location:{}};assert.ok(!Views.attendance(state).includes('<script>'));assert.ok(!Views.statistics(state).includes('<img>'));assert.equal(escapeHtml('"<>&\''),'&quot;&lt;&gt;&amp;&#39;');});
test('demo mutation retries are idempotent and clearing stays within date room',async()=>{const api=new DemoApi();const date='2026-09-30';const room=api.classrooms[0];const student=api.students[0];const payload={date,classroomId:room.id,records:[{studentId:student.id,status:'absent',reason:'ตัวอย่าง'}],mutationId:'stable-id'};await api.call('saveAttendance',payload);await api.call('saveAttendance',payload);assert.equal((await api.call('getAttendance',{date,classroomId:room.id})).records.length,1);await api.call('clearAttendance',{date,classroomId:room.id,mutationId:'clear-id'});assert.equal((await api.call('getAttendance',{date,classroomId:room.id})).records.length,0);assert.ok(api.rows.length>0);});


test('dashboard shows all five totals and a shared bar/line chart with exact weighted percentages',async()=>{
  const {AttendanceTrendChart}=await import('../assets/charts.js');
  const days=[{date:'2026-10-01',total:40,present:30,absent:2,leave:4,late:4,rate:82.5},{date:'2026-10-02',total:40,present:0,absent:40,leave:0,late:0,rate:0}];
  const data={summary:days[0],daily:days};
  for(const user of [null,{role:'admin',name:'ครู'}]){
    const html=Views.dashboard({user,settings:{},dashboard:data,classrooms:[],students:[],filters:{}});
    for(const key of ['stat-primary','stat-present','stat-absent','stat-leave','stat-late'])assert.ok(html.includes(key));
    assert.ok(html.includes('attendance-combo-chart'));assert.ok(html.includes('<rect'));assert.ok(html.includes('class="trend-line"'));assert.ok(html.includes('82.5%'));assert.ok(html.includes('0%'));assert.ok(html.includes('ดูตัวเลขรายวัน'));
  }
  assert.equal(AttendanceTrendChart.rate({...days[0],rate:null},{present:1,leave:0.5,late:0.25,absent:0}),82.5);
  assert.equal(AttendanceTrendChart.rate({...days[0],hasData:false},{}),null);
  assert.equal(AttendanceTrendChart.rate({total:0,rate:100},{}),null);
});

test('roster filters include every classroom while attendance selector only includes assigned rooms',()=>{
  const own={id:'A',name:'ม.1/1',advisorId:'teacher',advisorName:'ครู เอ'};const other={id:'B',name:'ม.1/2',advisorId:'other',advisorName:'ครู บี'};
  const state={user:{id:'teacher',role:'advisor'},settings:{},classrooms:[own],rosterClassrooms:[own,other],students:[{id:'s3',studentId:'00003',name:'นักเรียนห้องอื่น',classroomId:'B',active:true}],filters:{},attendance:{date:'2026-10-02',classroomId:'A',students:[],records:[]},location:{}};
  const roster=Views.students(state);assert.ok(roster.includes('<option value="B"'));assert.ok(roster.includes('นักเรียนห้องอื่น'));assert.ok(roster.includes('ครู บี'));assert.equal(roster.includes('data-action="edit-student"'),false);
  const attendance=Views.attendance(state);assert.ok(attendance.includes('<option value="A"'));assert.equal(attendance.includes('<option value="B"'),false);
  assert.ok(Views.attendance({...state,classrooms:[]}).includes('ยังไม่ได้รับมอบหมายห้องเรียน'));
});

test('public and signed dashboards share accessible date navigation, capped at today',async()=>{
  const {today}=await import('../assets/core.js');
  for(const user of [null,{role:'advisor',name:'ครู'}]){
    const html=Views.dashboard({user,settings:{},filters:{date:today()},dashboard:{date:today(),summary:{},daily:[]},classrooms:[]});
    for(const action of ['dashboard-previous','dashboard-today','dashboard-next'])assert.ok(html.includes(`data-action="${action}"`));
    assert.equal((html.match(/id="dashboard-date"/g)||[]).length,1);
    assert.match(html,/data-action="dashboard-next" disabled/);assert.ok(html.includes(`max="${today()}"`));
  }
});

test('roster groups by classroom with natural room/seat ordering and preserves filtering and escaping',()=>{
  const state={user:{role:'advisor'},settings:{},rosterClassrooms:[{id:'B',name:'ม.1/10',advisorId:'b',advisorName:'ครู บี'},{id:'A',name:'ม.1/2',advisorId:'a',advisorName:'ครู เอ'}],classrooms:[],filters:{},students:[{id:'s10',studentId:'00010',number:10,name:'คนสิบ',classroomId:'A'},{id:'s2',studentId:'00002',number:2,name:'คนสอง',classroomId:'A'},{id:'sB',studentId:'00003',number:1,name:'ห้องบี',classroomId:'B'},{id:'sX',studentId:'00004',name:'<script>ไม่ระบุ</script>'}]};
  const html=Views.students(state);assert.equal((html.match(/class="card roster-room"/g)||[]).length,3);
  assert.ok(html.indexOf('data-classroom-id="A"')<html.indexOf('data-classroom-id="B"'));assert.ok(html.indexOf('คนสอง')<html.indexOf('คนสิบ'));assert.ok(html.includes('ไม่ระบุห้องเรียน'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('00002'));assert.ok(!html.includes('data-action="edit-student"'));
  const filtered=Views.students({...state,studentFilters:{advisorId:'b'}});assert.ok(filtered.includes('data-classroom-id="B"'));assert.ok(!filtered.includes('data-classroom-id="A"'));assert.ok(!filtered.includes('คนสอง'));
  const search=Views.students({...state,studentFilters:{search:'00002'}});assert.equal((search.match(/class="card roster-room"/g)||[]).length,1);assert.ok(search.includes('คนสอง'));assert.ok(!search.includes('คนสิบ'));
  assert.ok(Views.students({...state,user:{role:'admin'}}).includes('data-action="edit-student"'));
});
