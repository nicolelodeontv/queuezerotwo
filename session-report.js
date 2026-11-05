/* QueueZeroTwo session recap: derived only from the local session log. */
(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=v=>String(v||'').trim().toLocaleLowerCase();
  const csv=v=>{
    let s=String(v??'');
    if(/^[=+@-]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  function buildSessionReport(state){
    const log=Array.isArray(state&&state.log)?state.log:[];
    const players=new Map(),partners=new Map();
    const ensure=name=>{
      const n=String(name||'').trim().slice(0,40),k=key(n);
      if(!k)return null;
      if(!players.has(k))players.set(k,{name:n,games:0,wins:0,losses:0,unknown:0,sitouts:null,partnerCounts:new Map()});
      return players.get(k);
    };
    log.forEach(match=>{
      if(!match||!Array.isArray(match.p)||match.p.length!==4)return;
      const winner=match.w===0||match.w===1?match.w:-1;
      match.p.forEach((name,i)=>{
        const p=ensure(name);if(!p)return;
        p.games++;
        if(winner<0)p.unknown++;
        else if((i<2?0:1)===winner)p.wins++;
        else p.losses++;
      });
      [[0,1],[2,3]].forEach(pair=>{
        const a=key(match.p[pair[0]]),b=key(match.p[pair[1]]);
        if(!a||!b||a===b)return;
        const k=[a,b].sort().join('|');
        partners.set(k,(partners.get(k)||0)+1);
        const pa=players.get(a),pb=players.get(b);
        if(pa)pa.partnerCounts.set(b,(pa.partnerCounts.get(b)||0)+1);
        if(pb)pb.partnerCounts.set(a,(pb.partnerCounts.get(a)||0)+1);
      });
    });
    const fair=state&&state.fair&&typeof state.fair==='object'?state.fair:{};
    const rows=[...players.values()].map(p=>{
      const f=fair[key(p.name)];
      p.sitouts=f&&Number.isFinite(Number(f.sitouts))?Math.max(0,Number(f.sitouts)):null;
      const partnerRows=[...p.partnerCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
      const names=new Map([...players.values()].map(x=>[key(x.name),x.name]));
      p.uniquePartners=partnerRows.length;
      p.topPartner=partnerRows.length?(names.get(partnerRows[0][0])||partnerRows[0][0])+' ('+partnerRows[0][1]+')':'—';
      p.winRate=p.wins+p.losses?Math.round(100*p.wins/(p.wins+p.losses)):null;
      return p;
    }).sort((a,b)=>b.wins-a.wins||b.winRate-b.winRate||b.games-a.games||a.name.localeCompare(b.name));
    const points=log.reduce((n,m)=>n+(Array.isArray(m.s)?Number(m.s[0]||0)+Number(m.s[1]||0):0),0);
    const courts=[...new Set(log.map(m=>String(m.c||'')).filter(Boolean))];
    const starts=log.map(m=>Number(m.t)||0).filter(Boolean);
    const durations=log.map(m=>Number(m.d)||0).filter(v=>v>0);
    return {name:String(state&&state.name||'Session').slice(0,40),players:rows,games:log.length,decidedGames:log.filter(m=>m&&(m.w===0||m.w===1)).length,points,courts:courts.length,averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0,startedAt:starts.length?Math.min(...starts.map((t,i)=>t-(Number(log.find(m=>Number(m.t)===t)?.d)||0))):0,endedAt:starts.length?Math.max(...starts):0,matches:log};
  }
  function downloadSessionCsv(report){
    const header=['Record Type','Session','Player','Games','Wins','Losses','Win Rate','Recorded Sit-outs','Unique Partners','Most Frequent Partner','Match Time','Court','Team 1','Score','Team 2','Winner','Duration (minutes)'];
    const lines=[header];
    lines.push(['Summary',report.name,'',report.games,'','','','','','','','','','','','','']);
    report.players.forEach(p=>lines.push(['Player',report.name,p.name,p.games,p.wins,p.losses,p.winRate===null?'':p.winRate+'%',p.sitouts===null?'':p.sitouts,p.uniquePartners,p.topPartner,'','','','','','','']));
    report.matches.forEach(m=>{
      const p=Array.isArray(m.p)?m.p:[];
      const winner=m.w===0?'Team 1':m.w===1?'Team 2':'No winner recorded';
      lines.push(['Match',report.name,'','','','','','','','',m.t?new Date(m.t).toISOString():'',m.c||'',p.slice(0,2).join(' & '),(m.s||[]).join('-'),p.slice(2,4).join(' & '),winner,Math.round((Number(m.d)||0)/60000)]);
    });
    const body='\uFEFF'+lines.map(row=>row.map(csv).join(',')).join('\r\n');
    const blob=new Blob([body],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    const slug=report.name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'session';
    a.href=url;a.download='queuezerotwo-'+slug+'-report-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openSessionReport(){
    if(!window.S||!Array.isArray(S.log))return;
    const report=buildSessionReport(S),fmt=n=>Number(n||0).toLocaleString(),duration=ms=>ms?Math.max(1,Math.round(ms/60000))+' min':'—';
    const rows=report.players.map(p=>'<tr class="border-t border-dark-700"><td class="px-3 py-2 text-white font-medium">'+esc(p.name)+'</td><td class="px-3 py-2 text-right">'+p.games+'</td><td class="px-3 py-2 text-right text-green-400">'+p.wins+'</td><td class="px-3 py-2 text-right">'+p.losses+'</td><td class="px-3 py-2 text-right">'+(p.winRate===null?'—':p.winRate+'%')+'</td><td class="px-3 py-2 text-right">'+(p.sitouts===null?'—':p.sitouts)+'</td><td class="px-3 py-2 text-right">'+p.uniquePartners+'</td><td class="px-3 py-2 text-left">'+esc(p.topPartner)+'</td></tr>').join('');
    const d=modal('<div class="p-5 border-b border-dark-700"><div class="flex items-start justify-between gap-3"><div><h3 class="text-2xl text-white">Session Summary</h3><p class="text-xs text-gray-400 mt-1">'+esc(report.name)+' · '+report.decidedGames+' decided matches</p></div><span class="text-[10px] rounded-full px-2 py-1 bg-blue-500/10 text-blue-300">LOCAL REPORT</span></div></div><div class="p-4 space-y-4 max-h-[72vh] overflow-y-auto"><div class="grid grid-cols-2 sm:grid-cols-4 gap-2"><div class="rounded-xl border border-dark-700 bg-dark-900 p-3"><div class="text-[10px] text-gray-400">Players</div><div class="font-sport text-2xl text-white">'+report.players.length+'</div></div><div class="rounded-xl border border-dark-700 bg-dark-900 p-3"><div class="text-[10px] text-gray-400">Games logged</div><div class="font-sport text-2xl text-white">'+report.games+'</div></div><div class="rounded-xl border border-dark-700 bg-dark-900 p-3"><div class="text-[10px] text-gray-400">Points scored</div><div class="font-sport text-2xl text-white">'+fmt(report.points)+'</div></div><div class="rounded-xl border border-dark-700 bg-dark-900 p-3"><div class="text-[10px] text-gray-400">Courts used</div><div class="font-sport text-2xl text-white">'+report.courts+'</div></div></div><div><div class="mb-2"><h4 class="text-sm font-semibold text-white">Player statistics</h4><p class="text-[11px] text-gray-400">Games include matches logged without a winner. Win rate uses decided matches only.</p></div><div class="overflow-x-auto rounded-xl border border-dark-700"><table class="w-full min-w-[760px] text-xs"><thead class="bg-dark-900 text-gray-400"><tr><th class="px-3 py-2 text-left">Player</th><th class="px-3 py-2 text-right">Games</th><th class="px-3 py-2 text-right">Wins</th><th class="px-3 py-2 text-right">Losses</th><th class="px-3 py-2 text-right">Win rate</th><th class="px-3 py-2 text-right">Sit-outs*</th><th class="px-3 py-2 text-right">Partners</th><th class="px-3 py-2 text-left">Most frequent partner</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" class="px-3 py-8 text-center text-gray-400">No completed matches to report yet.</td></tr>')+'</tbody></table></div></div><div class="rounded-xl border border-dark-700 bg-dark-900 p-3"><div class="text-sm font-semibold text-white mb-1">Match history</div><div class="text-xs text-gray-300">'+report.matches.slice(0,12).map(m=>'<div class="flex justify-between gap-3 py-1 border-t border-dark-700"><span class="truncate">'+esc(m.c||'Court')+' · '+esc((m.p||[]).join(' / '))+'</span><span class="flex-none">'+esc((m.s||[]).join('-'))+'</span></div>').join('')+(report.matches.length>12?'<p class="text-[11px] text-gray-500 mt-2">+'+(report.matches.length-12)+' more matches included in CSV</p>':'')+(report.matches.length?'':'<p class="text-xs text-gray-400">No matches logged yet.</p>')+'</div></div><p class="text-[11px] text-gray-500">* Sit-outs show only recorded fairness data. Older sit-outs from before fairness tracking are not reconstructable. All report data stays on this device unless you export or share it.</p><p class="text-[11px] text-gray-500">Average match duration: '+duration(report.averageDurationMs)+' · '+(report.startedAt?new Date(report.startedAt).toLocaleString()+' – '+new Date(report.endedAt).toLocaleString():'No match timestamps')+'</p></div><div class="p-4 border-t border-dark-700 flex gap-2"><button class="csv flex-1 '+bP+'"><i class="fa-solid fa-file-csv"></i> Download CSV</button><button data-x class="flex-1 '+bS+'">Close</button></div>');
    d.querySelector('.csv').onclick=()=>downloadSessionCsv(report);
  }
  function patchResultsDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')];
    for(const box of dialogs){
      if(!box.querySelector('#sn')||box.querySelector('.session-report-open'))continue;
      const backup=box.querySelector('.rb');if(!backup)continue;
      const button=document.createElement('button');
      button.type='button';button.className='session-report-open col-span-2 '+(window.bS||'');
      button.innerHTML='<i class="fa-solid fa-chart-column"></i> Session summary & player stats';
      button.addEventListener('click',openSessionReport);
      backup.parentElement.insertBefore(button,backup);
    }
  }
  window.buildSessionReport=buildSessionReport;
  window.downloadSessionCsv=downloadSessionCsv;
  window.openSessionReport=openSessionReport;
  const observer=new MutationObserver(patchResultsDialog);
  observer.observe(document.body,{childList:true,subtree:true});
  patchResultsDialog();
  if(window.S&&S.ended)setTimeout(patchResultsDialog,0);
})();
