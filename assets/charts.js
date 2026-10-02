import {escapeHtml} from './core.js';

// One renderer for public and signed-in dashboards; no chart library or extra fetch.
export class AttendanceTrendChart {
  static statuses = [
    ['present', 'มา', '#16a34a'], ['absent', 'ขาด', '#dc2626'],
    ['leave', 'ลา', '#0284c7'], ['late', 'สาย', '#ca8a04']
  ];
  static count(value) { return Math.max(0, Number(value) || 0); }
  static rate(day, weights) {
    if (day.hasData === false || !this.count(day.total)) return null;
    if (day.rate != null) return Math.max(0, Math.min(100, Number(day.rate) || 0));
    return Math.max(0, Math.min(100, this.statuses.reduce((sum, [key]) => sum + this.count(day[key]) * (Number(weights[key]) || 0), 0) / this.count(day.total) * 100));
  }
  static render(rows = [], weights = {present:1, absent:0, leave:0.5, late:0.25}) {
    const days = (Array.isArray(rows) ? rows : []).slice(-7);
    const f = value => new Intl.NumberFormat('th-TH', {maximumFractionDigits:1}).format(value);
    const dateLabel = value => {
      const date = new Date(String(value).slice(0,10) + 'T12:00:00+07:00');
      return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('th-TH', {day:'numeric', month:'short'}).format(date);
    };
    const rates = days.map(day => this.rate(day, weights));
    const latest = rates.reduce((result, rate) => rate == null ? result : rate, null);
    const legend = this.statuses.map(([key,label]) => `<span><i class="trend-swatch trend-${key}"></i>${label}</span>`).join('') + '<span><i class="trend-line-key"></i>อัตรามาเรียน (%)</span>';
    const heading = `<div class="card-heading"><div><h2>แนวโน้มการมาเรียน</h2><p>7 วันล่าสุด · แท่ง: จำนวนคน · เส้น: ร้อยละตามน้ำหนักที่ตั้งไว้</p></div><div class="trend-latest"><span>อัตราล่าสุด</span><strong>${latest == null ? '—' : f(latest) + '%'}</strong></div></div><div class="trend-legend">${legend}</div>`;
    if (!days.some(day => this.count(day.total))) return `<section class="card trend-card">${heading}<div class="empty-state"><h3>ยังไม่มีข้อมูลแนวโน้ม</h3><p>กราฟจะแสดงเมื่อมีข้อมูลการเช็คชื่อ</p></div></section>`;
    const width=760, left=52, right=708, top=40, bottom=238, height=bottom-top;
    const totals=days.map(day => this.statuses.reduce((sum,[key])=>sum+this.count(day[key]),0));
    const maximum=Math.max(4,...totals), step=Math.ceil(maximum/4), max=step*4;
    const x=i=>left+(right-left)/days.length*(i+0.5);
    const yRate=rate=>bottom-rate/100*height;
    const grid=[0,1,2,3,4].map(i=>{
      const y=bottom-i/4*height;
      return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="trend-grid"/><text x="${left-10}" y="${y+5}" text-anchor="end">${f(i*step)}</text><text x="${right+10}" y="${y+5}">${i*25}%</text>`;
    }).join('');
    const bars=days.map((day,i)=>{
      let y=bottom;
      const rects=this.statuses.map(([key,label,color])=>{
        const count=this.count(day[key]), h=count/max*height;y-=h;
        return count ? `<rect x="${x(i)-18}" y="${y}" width="36" height="${h}" fill="${color}"><title>${escapeHtml(dateLabel(day.date))} · ${label} ${f(count)} คน</title></rect>` : '';
      }).join('');
      return rects+`<text x="${x(i)}" y="${bottom+25}" text-anchor="middle">${escapeHtml(dateLabel(day.date))}</text>`;
    }).join('');
    let connected=false;
    const path=rates.map((rate,i)=>{
      if(rate==null){connected=false;return '';}
      const command=connected?'L':'M';connected=true;return `${command}${x(i)},${yRate(rate)}`;
    }).join(' ');
    const points=rates.map((rate,i)=>rate==null?'':`<circle cx="${x(i)}" cy="${yRate(rate)}" r="5" class="trend-point"/><text x="${x(i)}" y="${yRate(rate)-12}" text-anchor="middle" class="trend-percent">${f(rate)}%</text>`).join('');
    const table=`<details class="trend-data"><summary>ดูตัวเลขรายวัน</summary><div class="table-wrap"><table class="data-table"><caption class="sr-only">ข้อมูลแนวโน้มการมาเรียน</caption><thead><tr><th scope="col">วันที่</th>${this.statuses.map(([,label])=>`<th scope="col">${label}</th>`).join('')}<th scope="col">ทั้งหมด</th><th scope="col">อัตรา (%)</th></tr></thead><tbody>${days.map((day,i)=>`<tr><th scope="row">${escapeHtml(dateLabel(day.date))}</th>${this.statuses.map(([key])=>`<td>${f(this.count(day[key]))}</td>`).join('')}<td>${f(this.count(day.total))}</td><td>${rates[i]==null?'ไม่มีข้อมูล':f(rates[i])+'%'}</td></tr>`).join('')}</tbody></table></div></details>`;
    return `<section class="card trend-card">${heading}<div class="trend-scroll" tabindex="0" role="region" aria-label="กราฟแนวโน้ม 7 วัน เลื่อนดูได้บนมือถือ"><svg class="attendance-combo-chart" viewBox="0 0 ${width} 290" role="img" aria-label="กราฟแท่งแสดงจำนวนมา ขาด ลา สาย และเส้นแสดงอัตรามาเรียนเป็นร้อยละ ดูตัวเลขได้ในตารางรายวัน"><text x="${left}" y="18">จำนวน (คน)</text><text x="${right}" y="18" text-anchor="end">ร้อยละ (%)</text>${grid}${bars}<path d="${path}" class="trend-line"/>${points}</svg></div>${table}<p class="trend-note">บนมือถือเลื่อนกราฟซ้าย–ขวาเพื่อดูครบทุกวัน · วันที่ไม่มีข้อมูลแสดงช่องว่างในเส้นกราฟ · ร้อยละคำนวณตามค่าน้ำหนักสถานะในตั้งค่า</p></section>`;
  }
}
