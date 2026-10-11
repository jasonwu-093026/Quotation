// 私人入口：只由伺服器核對擁有者，瀏覽器不保存密碼；不提供持股 API。
import http from 'node:http';
import {scryptSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const assets={'/':'login.html','/login.js':'login.js','/app.html':'app.html','/app.js':'app.js','/style.css':'style.css','/core.js':'core.js','/src/decimal.js':'../src/decimal.js'};
export function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function createPrivateServer({owner,hash,origin,now=Date.now}){
 if(!owner||!/^([a-f0-9]{32}):([a-f0-9]{128})$/.test(hash||''))throw Error('請設定 INVEST_OWNER 與有效的密碼雜湊 INVEST_PASSWORD_HASH');
 const publicURL=new URL(origin);if(publicURL.origin!==origin||(!['localhost','127.0.0.1'].includes(publicURL.hostname)&&publicURL.protocol!=='https:'))throw Error('公開私人網站必須設定 HTTPS origin');
 const [salt,digest]=hash.split(':');const expected=Buffer.from(digest,'hex');const sessions=new Map();let attempts=[];
 const server=http.createServer(async(req,res)=>{
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"});res.end(typeof body==='string'?body:JSON.stringify(body));};
  for(const [key,expires] of sessions)if(expires<=now())sessions.delete(key);
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('invest_session='))?.slice(15);const authenticated=sessions.has(cookie);
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='POST'){
   if(req.headers.origin!==origin){send(403,{error:'請從私人網站操作'});return;}
   if(path==='/api/logout'){sessions.delete(cookie);res.setHeader('Set-Cookie','invest_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(publicURL.protocol==='https:'?'; Secure':''));send(200,{});return;}
   if(path!=='/api/login'){send(404,{});return;}
   attempts=attempts.filter(t=>t>now()-60000);if(attempts.length>=10){res.setHeader('Retry-After','60');send(429,{error:'嘗試次數過多，請稍後再試'});return;}attempts.push(now());
   try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){send(413,{error:'輸入過長'});return;}}
    const data=JSON.parse(body);if(typeof data.password!=='string'||data.password.length>256){send(401,{error:'帳號或密碼錯誤'});return;}
    const actual=scryptSync(data.password,salt,64);
    if(data.username!==owner||!timingSafeEqual(actual,expected)){send(401,{error:'帳號或密碼錯誤'});return;}
    if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
    const token=randomBytes(32).toString('hex');sessions.set(token,now()+8*3600000);res.setHeader('Set-Cookie',`invest_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`+(publicURL.protocol==='https:'?'; Secure':''));send(200,{});
   }catch{send(400,{error:'登入資料格式錯誤'});}return;
  }
  if(req.method!=='GET'){send(405,{});return;}
  if(path==='/api/session'){send(authenticated?200:401,{authenticated});return;}
  if(!['/','/login.js','/style.css'].includes(path)&&!authenticated){send(401,{error:'請先登入'});return;}
  const asset=assets[path];if(!asset){send(404,{});return;}
  try{send(200,readFileSync(new URL(asset,import.meta.url),'utf8'),path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');}catch{send(404,{});}
 });server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--hash-password')){let password='';for await(const data of process.stdin)password+=data;password=password.replace(/\r?\n$/,'');if(password.length<12||password.length>256)throw Error('密碼長度需為 12 至 256 字');console.log(passwordHash(password));}
 else{const port=Number(process.env.PORT||9006);const server=createPrivateServer({owner:process.env.INVEST_OWNER,hash:process.env.INVEST_PASSWORD_HASH,origin:process.env.INVEST_ORIGIN||`http://127.0.0.1:${port}`});server.listen(port,'127.0.0.1',()=>console.log(`私人投資工具啟動於 127.0.0.1:${port}`));}
}
