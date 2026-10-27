// generate.mjs — 用已登入的 l0veyou 瀏覽器生一張圖（GPT Image 2），原圖存到 output/l0veyou/。
// 前置：先開專用瀏覽器（獨立設定檔、CDP 9447），使用者在視窗裡登入一次，之後設定檔記得登入：
//   "<playwright chromium>/chrome.exe" --remote-debugging-port=9447 --user-data-dir="<work>/.l0veyou-profile" https://l0veyou.com/chat
// 用法：[REF=參考圖.png] node pipeline/scripts/l0veyou/generate.mjs <prompt檔> <輸出路徑（副檔名自動依內容改 .png/.jpg）> [截圖目錄] [比例 1:1|16:9|...]
// 每次都開新對話（避免「多參考圖」拿前一張當參考）。4 欄物件表用 16:9；生完一定跑 sheet_to_atlas.py 的碰邊檢查。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execSync} from 'node:child_process';
let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(path.join(execSync('npm root -g').toString().trim(),'playwright','index.js')).href);}
const {chromium}=pw.default||pw;
let [promptFile,outFile,shotDir='',ratio='1:1']=process.argv.slice(2);
const prompt=fs.readFileSync(promptFile,'utf8').trim();
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const b=await chromium.connectOverCDP('http://127.0.0.1:9447');const ctx=b.contexts()[0];
// 自己開一個新分頁（不搶別的 agent 正在用的分頁），用完關掉。
const p=await ctx.newPage();await p.bringToFront();await p.goto('https://l0veyou.com/chat',{waitUntil:'domcontentloaded',timeout:90000});
for(let i=0;i<20;i++){await p.waitForTimeout(1000);const t=await p.evaluate(()=>document.body?document.body.innerText:'');if(t.includes('登录 / 注册')){log('NOT_LOGGED_IN');await p.close();process.exit(2);}if(await p.locator('button.new-chat').count())break;}
await p.bringToFront();await p.waitForTimeout(500);
await p.locator('button.new-chat').click();await p.waitForTimeout(1500);
const rail=p.locator('button.rail-btn',{hasText:'AI 生图'});if(await rail.count()&&!(await rail.getAttribute('class')).includes('active')){await rail.click();await p.waitForTimeout(800);}
const model=(await p.locator('button.model-trigger').innerText()).trim();log('model:',model);
if(model!=='GPT Image 2'){await p.locator('button.model-trigger').click();await p.waitForTimeout(600);await p.getByText('GPT Image 2',{exact:true}).last().click();await p.waitForTimeout(600);log('model now:',(await p.locator('button.model-trigger').innerText()).trim());}
await p.locator('button.ratio-btn').filter({hasText:new RegExp('^'+ratio+'$')}).click();await p.waitForTimeout(300);log('ratio:',(await p.locator('button.ratio-btn.active').innerText()).trim());
// 「多參考圖」若存在且開著就關掉（文件說會用前面的圖當參考、污染風格）
const multi=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/多参考图|多參考圖/.test(e.textContent||'')).map(e=>e.parentElement.outerHTML.slice(0,300)));
if(multi.length)log('multi-ref control:',multi.join(' | '));
{const clr=p.getByText('清空',{exact:true});for(let i=0;i<4&&await clr.count();i++){await clr.first().click().catch(()=>{});await p.waitForTimeout(500);}}
if(process.env.REF||process.env.REFS){const fs_=(process.env.REFS||process.env.REF).split('|');
  // 一張以上要先開「多参考图」（關著時 file input 只收一張）；新對話裡沒有前面的圖，不會被拿去當參考
  if(fs_.length>1&&(await p.locator('button.ref-toggle').getAttribute('aria-checked'))!=='true'){await p.locator('button.ref-toggle').click();await p.waitForTimeout(600);}
  for(const f of fs_){await p.locator('input.file-input').setInputFiles(f);await p.waitForTimeout(5000);}
  const th=await p.evaluate(()=>[...document.images].filter(i=>/blob:|data:/.test(i.currentSrc||i.src)).map(i=>i.naturalWidth+'x'+i.naturalHeight));log('refs attached',fs_.length,'thumbs',th.join(','));
  if(th.length<fs_.length){log('REF_ATTACH_FAILED');await p.close();process.exit(4);}}
const before=new Set(await p.evaluate(()=>[...document.images].map(i=>i.currentSrc||i.src)));
const ta=p.locator('textarea[aria-label="消息输入框"]');await ta.click();await ta.fill(prompt);await p.waitForTimeout(400);
if(shotDir)await p.screenshot({path:shotDir+'/l0v-gen-1-ready.png',timeout:15000}).catch(()=>log('screenshot skipped'));
const reqlog=[];p.on('console',m=>{if(['error','warning'].includes(m.type()))reqlog.push('console.'+m.type()+': '+m.text().slice(0,200));});
p.on('requestfinished',r=>{if(!/\.(png|jpg|svg|woff2?|css|js|webp)(\?|$)/.test(r.url())&&!/cloudfront/.test(r.url()))reqlog.push(r.method()+' '+r.url().slice(0,90));});
p.on('requestfailed',r=>reqlog.push('FAILED '+r.method()+' '+r.url().slice(0,90)+' '+(r.failure()?.errorText||'')));
let posted=false;p.on('request',r=>{if(r.method()==='POST'&&/images\/generate/.test(r.url()))posted=true;});
for(let k=0;k<1&&!posted;k++){
  const st=await p.evaluate(()=>({ta:(document.querySelector('textarea[aria-label="消息输入框"]')?.value||'').length,btn:document.querySelector('button.send')?.className,dis:document.querySelector('button.send')?.disabled}));
  log('send try',k,JSON.stringify(st));
  await p.locator('button.send').click();
  for(let t=0;t<20&&!posted;t++)await p.waitForTimeout(500);
  if(!posted){const st2=await p.evaluate(()=>({ta:(document.querySelector('textarea[aria-label="消息输入框"]')?.value||'').length,btn:document.querySelector('button.send')?.className,tail:(document.querySelector('main')||document.body).innerText.slice(-160)}));log('not posted',JSON.stringify(st2));
    if(st2.ta===0){await p.locator('textarea[aria-label="消息输入框"]').fill(prompt);await p.waitForTimeout(800);}}
}
if(!posted){log('reqlog: '+reqlog.slice(-25).join(' || '));log('toasts',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('[class*=toast],[class*=message],[class*=notif],[role=alert],[class*=error]')].map(e=>e.innerText.trim()).filter(t=>t&&t.length<200))));log('SEND_FAILED');await p.close().catch(()=>{});process.exit(5);}
log('sent, prompt chars',prompt.length);
const t0=Date.now();let url=null,lastTxt='';
while(Date.now()-t0<5*60e3){
  await p.waitForTimeout(5000);
  const imgs=await p.evaluate(()=>[...document.images].map(i=>({src:i.currentSrc||i.src,w:i.naturalWidth,h:i.naturalHeight,done:i.complete})));
  const fresh=imgs.filter(i=>!before.has(i.src)&&!i.src.startsWith('data:')&&!i.src.startsWith('blob:')&&i.done&&i.w>=512&&i.h>=384);
  if(fresh.length){url=fresh[fresh.length-1].src;log('image',fresh[fresh.length-1].w+'x'+fresh[fresh.length-1].h,'after',Math.round((Date.now()-t0)/1000),'s');break;}
  const txt=await p.evaluate(()=>{const m=document.querySelector('main')||document.body;return m.innerText.slice(-400);});
  if(txt!==lastTxt){lastTxt=txt;log('page tail:',txt.replace(/\s+/g,' ').slice(-200));}
}
if(shotDir)await p.screenshot({path:shotDir+'/l0v-gen-2-result.png',timeout:15000}).catch(()=>log('screenshot skipped'));
if(!url){log('NO_IMAGE');await p.close().catch(()=>{});process.exit(3);}
log('url:',url.slice(0,160));
let buf;
if(url.startsWith('data:')){buf=Buffer.from(url.split(',')[1],'base64');}
else{const r=await ctx.request.get(url);log('http',r.status(),r.headers()['content-type']);buf=await r.body();}
// 16:9 回 PNG、1:1 常回 JPEG：副檔名照內容
const ext=buf.slice(0,4).toString('hex')==='89504e47'?'.png':'.jpg';outFile=outFile.replace(/\.(png|jpe?g)$/i,'')+ext;
fs.writeFileSync(outFile,buf);log('saved',outFile,buf.length,'bytes');
await p.close().catch(()=>{});await b.close().catch(()=>{}); // 關自己的分頁、斷開 CDP 連線，不會關掉使用者的瀏覽器
