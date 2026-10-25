import fs from "node:fs";
import { spawnSync } from "node:child_process";
const BASE="https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const key=JSON.parse(fs.readFileSync("fixtures/seed-meta.json","utf8")).apiKey;
const stamp=Date.now().toString(36); const prefix=`m3size-${stamp}`;
const text=(bytes)=>`## Tiêu đề\n\n${"Nội dung tiếng Việt có **đậm**, [liên kết](https://example.com), danh sách:\n\n- một\n- hai\n\n".repeat(Math.ceil(bytes/100)).slice(0,bytes)}`;
const results=[];
for(const kb of [2,8,16,32,64,128,256]){
  const started=Date.now();
  let response, body;
  try { response=await fetch(`${BASE}/api/v1/posts`,{method:"POST",headers:{"user-agent":"Mozilla/5.0 M3-Size",authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({title:`M3 size ${kb}K ${stamp}`,slug:`${prefix}-${kb}`,content:text(kb*1024),content_format:"markdown",status:"draft"}),signal:AbortSignal.timeout(60000)}); body=await response.text(); }
  catch(error){ results.push({kb,status:0,error:String(error.message||error),wall_ms:Date.now()-started}); continue; }
  const wall=Date.now()-started; let json=null; try{json=JSON.parse(body);}catch{}
  results.push({kb,status:response.status,wall_ms:wall,content_bytes:json?.data?.content_html?.length||null,error:json?.error?.code||null});
  console.log(kb+"KB",response.status,wall+"ms",json?.error?.code||"");
  await new Promise(r=>setTimeout(r,700));
}
fs.writeFileSync(`fixtures/m3-size-${stamp}.json`,JSON.stringify({results},null,2));
const sql=`DELETE FROM posts_fts WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%'); DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%'); DELETE FROM revisions WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%'); DELETE FROM slug_history WHERE post_id IN (SELECT id FROM posts WHERE slug LIKE '${prefix}%'); DELETE FROM posts WHERE slug LIKE '${prefix}%';`;
fs.writeFileSync(`fixtures/.${prefix}.sql`,sql);
spawnSync("npx.cmd",["wrangler","d1","execute","meohay-m0-stg-230403","--remote","-c","wrangler.remote.jsonc","--env-file",".env.wrangler","--file",`fixtures/.${prefix}.sql`],{encoding:"utf8",shell:true});
