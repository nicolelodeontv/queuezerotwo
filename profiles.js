/* PickleStack: all-time player profiles. Saved on this device, separate from the session, so New session keeps them. */
(function(){
const PK='pickleStackPlayers',ky=n=>n.toLowerCase();
let P={};
try{P=JSON.parse(localStorage.getItem(PK))||{}}catch(e){P={}}
const sv=()=>{try{localStorage.setItem(PK,JSON.stringify(P));return true}catch(e){return false}};
window.pRestore=s=>{if(!s)return;try{const o=JSON.parse(s);P=o.p||{};S.pseen=o.ps||{};sv()}catch(e){}};
const num=(v,m)=>Math.min(m,Math.max(0,Math.floor(Number(v))||0));
const ptc=o=>{const r={};if(o&&typeof o==='object')Object.keys(o).slice(0,300).forEach(k=>{const x=o[k];if(x&&k!=='__proto__')r[String(k).slice(0,40)]={n:String(x.n||'').slice(0,40),g:num(x.g,1e5),w:num(x.w,1e5)}});return r};
const safeAvatar=v=>typeof v==='string'&&v.length<=100000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v)?v:'';
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(x=>Array.from(x)[0]||'').join('').toUpperCase()||'?';
function avatarHTML(r,size=44){
  const src=safeAvatar(r.avatar),base='display:inline-flex;align-items:center;justify-content:center;overflow:hidden;width:'+size+'px;height:'+size+'px;border-radius:50%;flex:none;';
  return src
    ? '<img alt="" src="'+src+'" style="display:block;width:'+size+'px;height:'+size+'px;object-fit:cover;flex:none;border-radius:50%;border:2px solid #334155">'
    : '<span aria-hidden="true" style="'+base+'background:#ccff00;color:#0B0F19;font-size:'+Math.max(12,Math.round(size*.32))+'px;font-weight:800;border:2px solid #334155">'+esc(initials(r.n))+'</span>';
}
function refreshAvatarRows(r){
  document.querySelectorAll('.pr').forEach(b=>{
    if(b.dataset.k===ky(r.n)){const a=b.querySelector('.profile-list-avatar');if(a)a.innerHTML=avatarHTML(r,40)}
  });
}
const cln=x=>({n:String(x.n).slice(0,40),w:num(x.w,1e5),l:num(x.l,1e5),pf:num(x.pf,1e7),pa:num(x.pa,1e7),s:num(x.s,1e5),last:num(x.last,9e15),form:(Array.isArray(x.form)?x.form:[]).slice(0,10).map(f=>f=='W'?'W':'L'),pt:ptc(x.pt),lv:num(x.lv,6),avatar:safeAvatar(x.avatar)});
const row=n=>P[ky(n)]||(P[ky(n)]={n,w:0,l:0,pf:0,pa:0,s:0,last:0,form:[],pt:{},lv:0});
const dt=t=>t?new Date(t).toLocaleDateString([],{month:'short',day:'numeric'}):'never';
const pct=r=>r.w+r.l?Math.round(100*r.w/(r.w+r.l)):0;

/* Record each finished, scored match */
const _fin=fin;
fin=function(id){
  window.__pundo=null;
  const c=S.courts.find(x=>x.id==id);
  if(c&&c.isActive){
    const w=win(c.score,S.target);
    if(w>=0){
      window.__pundo=JSON.stringify({p:P,ps:S.pseen||{}});S.pseen=S.pseen||{};
      c.players.forEach((n,i)=>{
        const t=i<2?0:1,r=row(n),won=w==t,m=c.players[t*2+(1-i%2)];
        won?r.w++:r.l++;r.pf+=c.score[t];r.pa+=c.score[1-t];r.last=Date.now();
        r.form.unshift(won?'W':'L');r.form=r.form.slice(0,10);
        if(!S.pseen[ky(n)]){S.pseen[ky(n)]=1;r.s++}
        const p=r.pt[ky(m)]||(r.pt[ky(m)]={n:m,g:0,w:0});p.g++;if(won)p.w++;
        if(S.lv&&S.lv[ky(n)])r.lv=S.lv[ky(n)];
      });
      sv();
    }
  }
  return _fin(id);
};

function addP(n){
  const k=ky(n),all=[...S.queue,...S.waiting,...S.courts.flatMap(c=>c.isActive?c.players:[])];
  if(all.some(x=>ky(x)==k))return toast(n+' is already in this session.','error');
  S.waiting.push(n);
  const r=P[k];if(r&&r.lv&&!S.lv[k])S.lv[k]=r.lv;
  save();render();toast(n+' added to Not yet here','success');
}
function best(r){
  const a=Object.values(r.pt).filter(x=>x.g>=2).sort((a,b)=>b.w/b.g-a.w/a.g||b.g-a.g)[0]||Object.values(r.pt).sort((a,b)=>b.g-a.g)[0];
  return a?a.n+' ('+a.w+'-'+(a.g-a.w)+' together)':'none yet';
}
function chooseAvatar(r,done){
  const input=document.createElement('input');
  input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;
  document.body.appendChild(input);
  input.onchange=()=>{
    const f=input.files&&input.files[0];input.remove();if(!f)return;
    if(!/^image\/(jpeg|png|webp)$/.test(f.type)||f.size>5*1024*1024){toast('Choose a JPG, PNG or WebP image under 5 MB.','error');return}
    const rd=new FileReader();
    rd.onerror=()=>toast('Could not read that image.','error');
    rd.onload=()=>{
      const img=new Image();
      img.onerror=()=>toast('That image could not be opened.','error');
      img.onload=()=>{
        try{
          if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>8000||img.naturalHeight>8000)throw new Error('Image dimensions are not supported.');
          const side=128,canvas=document.createElement('canvas');canvas.width=side;canvas.height=side;
          const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image processing is unavailable.');
          const crop=Math.min(img.naturalWidth,img.naturalHeight);
          ctx.drawImage(img,(img.naturalWidth-crop)/2,(img.naturalHeight-crop)/2,crop,crop,0,0,side,side);
          const previous=r.avatar;r.avatar=canvas.toDataURL('image/jpeg',.82);
          if(!sv()){r.avatar=previous;throw new Error('Could not save the avatar. Free up device storage and try again.')}
          done();toast('Avatar saved on this device.','success');
        }catch(e){toast(e.message||'Could not process that image.','error')}
      };
      img.src=String(rd.result||'');
    };
    rd.readAsDataURL(f);
  };
  input.click();
}
function profile(r){
  const g=r.w+r.l,d=r.pf-r.pa,box=modal('').querySelector('.mb');
  box.innerHTML='<div class="p-5 border-b border-dark-700 flex justify-between items-start"><div class="flex items-center gap-3 min-w-0"><div class="avatar-preview">'+avatarHTML(r,56)+'</div><div class="min-w-0"><h3 class="text-xl text-white">'+esc(r.n)+'</h3><p class="text-xs text-gray-400">'+(r.lv?'★'.repeat(r.lv)+' · ':'')+'Last played '+dt(r.last)+'</p></div></div><button data-x class="text-gray-400 text-xl" aria-label="Close">✕</button></div>'
  +'<div class="px-5 pt-4 flex items-center gap-2 flex-wrap"><button data-avatar class="rounded-lg bg-dark-700 border border-dark-700 text-gray-200 px-3 py-2 text-sm">'+(safeAvatar(r.avatar)?'Change avatar':'Add avatar')+'</button><button data-remove-avatar '+(safeAvatar(r.avatar)?'':'hidden')+' class="rounded-lg bg-dark-700 text-gray-300 px-3 py-2 text-sm">Remove avatar</button><span class="text-xs text-gray-400">Stored on this device. Use Back up to transfer it.</span></div>'
  +'<div class="grid grid-cols-3 gap-3 p-5 text-center">'+[[r.w+'-'+r.l,'W-L'],[pct(r)+'%','Win rate'],[g,'Games'],[r.s,'Sessions'],[g?(r.pf/g).toFixed(1):'0','Avg points'],[(d>0?'+':'')+d,'+/-']].map(x=>'<div class="bg-dark-900 border border-dark-700 rounded-xl p-3"><div class="font-sport text-2xl text-white">'+x[0]+'</div><div class="text-[10px] text-gray-500">'+x[1]+'</div></div>').join('')+'</div>'
  +'<div class="px-5 pb-4 text-sm text-gray-300"><div class="mb-2">Recent form: '+(r.form.length?r.form.map(f=>'<span class="inline-block w-6 text-center rounded text-xs font-bold '+(f=='W'?'bg-green-500/20 text-green-400':'bg-red-500/20 text-red-400')+'">'+f+'</span>').join(' '):'<span class="text-gray-500">no games yet</span>')+'</div><div>Best partner: '+esc(best(r))+'</div></div>'
  +'<div class="p-4 border-t border-dark-700 grid grid-cols-2 gap-3"><button data-x class="'+bS+'">Back</button><button class="ad '+bP+'">Add to session</button></div>';
  box.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>box.parentElement.remove());
  const avatarButton=box.querySelector('[data-avatar]'),removeAvatarButton=box.querySelector('[data-remove-avatar]');
  const refreshAvatar=()=>{box.querySelector('.avatar-preview').innerHTML=avatarHTML(r,56);avatarButton.textContent=safeAvatar(r.avatar)?'Change avatar':'Add avatar';removeAvatarButton.hidden=!safeAvatar(r.avatar);refreshAvatarRows(r)};
  avatarButton.onclick=()=>chooseAvatar(r,refreshAvatar);
  removeAvatarButton.onclick=()=>{const previous=r.avatar;r.avatar='';if(!sv()){r.avatar=previous;toast('Could not save the change. Free up device storage and try again.','error');return}refreshAvatar();toast('Avatar removed.','success')};
  box.querySelector('.ad').onclick=()=>{addP(r.n);box.parentElement.remove()};
}
function open(){
  const d=modal(''),box=d.querySelector('.mb');
  box.innerHTML='<div class="p-5 border-b border-dark-700 flex justify-between items-start"><div><h3 class="text-xl text-white">Players</h3><p class="text-xs text-gray-400">All-time stats on this device</p></div><button data-x class="text-gray-400 text-xl" aria-label="Close">✕</button></div>'
  +'<div class="p-4 flex gap-2 border-b border-dark-700"><input class="q flex-grow min-w-0 bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pickle-500" placeholder="Search"><select class="so bg-dark-900 border border-dark-700 rounded px-2 text-sm text-white"><option value="w">Wins</option><option value="p">Win %</option><option value="g">Games</option><option value="r">Recent</option><option value="n">Name</option></select></div>'
  +'<div class="ls divide-y divide-dark-700"></div>'
  +'<div class="p-4 border-t border-dark-700 grid grid-cols-2 gap-3"><button class="ex '+bS+'">Back up</button><button class="im '+bS+'">Restore</button><input type="file" accept=".json,application/json" class="fl hidden"></div>';
  const ls=box.querySelector('.ls'),q=box.querySelector('.q'),so=box.querySelector('.so');
  const draw=()=>{
    const k=q.value.trim().toLowerCase(),v=so.value,
    s={w:(a,b)=>b.w-a.w||pct(b)-pct(a),p:(a,b)=>pct(b)-pct(a)||b.w-a.w,g:(a,b)=>(b.w+b.l)-(a.w+a.l),r:(a,b)=>b.last-a.last,n:(a,b)=>a.n.localeCompare(b.n)}[v];
    const L=Object.values(P).filter(r=>!k||r.n.toLowerCase().includes(k)).sort(s);
    ls.innerHTML=L.length?L.map(r=>'<div class="flex items-center gap-2 p-3"><button class="pr flex-1 min-w-0 text-left" data-k="'+esc(ky(r.n))+'"><div class="flex items-center gap-3"><span class="profile-list-avatar">'+avatarHTML(r,40)+'</span><span class="min-w-0"><span class="block truncate text-white">'+esc(r.n)+'</span><span class="block text-xs text-gray-400">'+r.w+'-'+r.l+' · '+pct(r)+'% · '+r.s+' sessions</span></span></div></button><button class="pa w-9 h-9 rounded-lg bg-pickle-500 text-dark-900" title="Add to session" data-k="'+esc(ky(r.n))+'"><i class="fa-solid fa-plus"></i></button></div>').join('')
    :'<p class="p-8 text-center text-sm text-gray-500">'+(Object.keys(P).length?'No match.':'No players yet. Finish a scored match and they appear here.')+'</p>';
    ls.querySelectorAll('.pr').forEach(b=>b.onclick=()=>profile(P[b.dataset.k]));
    ls.querySelectorAll('.pa').forEach(b=>b.onclick=()=>addP(P[b.dataset.k].n));
  };
  q.oninput=draw;so.onchange=draw;draw();
  box.querySelector('[data-x]').onclick=()=>d.remove();
  box.querySelector('.ex').onclick=()=>{
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({v:1,players:P})],{type:'application/json'}));
    a.download='queuezerotwo-players.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Backup saved','success')};
  const fl=box.querySelector('.fl');box.querySelector('.im').onclick=()=>fl.click();
  fl.onchange=()=>{const f=fl.files[0];if(!f)return;const rd=new FileReader();
    rd.onload=()=>{try{const o=JSON.parse(rd.result).players;let n=0;
      Object.keys(o).slice(0,2000).forEach(k=>{const x=o[k];if(!x||!x.n)return;const y=cln(x),kk=ky(y.n),c=P[kk];if(kk!=='__proto__'&&(!c||y.w+y.l>c.w+c.l)){P[kk]=y;n++}});
      sv();draw();toast('Restored '+n+' players','success')}catch(e){toast('That file could not be read.','error')}};
    rd.readAsText(f)};
}
const b=document.createElement('button');
b.title='Players';b.setAttribute('aria-label','Players');
b.className='bg-dark-700 hover:bg-pickle-500 hover:text-dark-900 rounded-lg w-10 h-10';
b.innerHTML='<i class="fa-solid fa-address-book"></i>';b.onclick=open;
const anchor=document.querySelector('button[onclick="hist()"]');if(anchor)anchor.before(b);
})();
