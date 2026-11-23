import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = ['admin', 'manager', 'editor', 'viewer'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' };
const STATIC_MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon', '.woff2':'font/woff2', ...MIME };
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const safeEqual = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y); };
export function passwordHash(password) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
function passwordValid(password, hash) { try { const [salt,key]=hash.split(':'); return safeEqual(scryptSync(password,salt,64).toString('hex'), key); } catch { return false; } }
function validatePassword(value) { if(typeof value!=='string'||value.length<12||value.length>128) fail(400,'A senha deve ter entre 12 e 128 caracteres.'); return value; }
function label(value, max=120) { if(typeof value!=='string'||!value.trim()||value.length>max) fail(400,`Informe um texto válido de até ${max} caracteres.`); return value.trim(); }
function email(value) { const result=label(value,254).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400,'Informe um e-mail válido.'); return result; }
function parseTime(value) { if(value===null||value===''||value===undefined) return null; if(typeof value!=='string'||!Number.isFinite(Date.parse(value))) fail(400,'Data e hora inválidas.'); return new Date(value).toISOString(); }
function publicUser(user) { if(!user) return null; const {password,...result}=user; return result; }
function signature(bytes,extension) {
  if(extension==='.png') return bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(extension==='.jpg'||extension==='.jpeg') return bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(extension==='.webp') return bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(extension==='.pdf') return bytes.toString('ascii',0,5)==='%PDF-';
  if(extension==='.mp4') return bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp';
  if(extension==='.webm') return bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  return false;
}

export function createApp(options={}) {
  const production=(options.production ?? process.env.NODE_ENV==='production');
  const port=Number(options.port ?? process.env.PORT ?? 4173);
  const host=options.host ?? process.env.HOST ?? '127.0.0.1';
  const origin=options.origin ?? process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  const dataDir=path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(root,'data'));
  const scanner=options.scanner ?? process.env.MALWARE_SCANNER ?? '';
  const setupToken=options.setupToken ?? process.env.SETUP_TOKEN ?? '';
  const maxUpload=Number(options.maxUpload ?? process.env.MAX_UPLOAD_MB ?? 50)*1024*1024;
  if(!Number.isFinite(maxUpload)||maxUpload<1024||maxUpload>250*1024*1024) throw new Error('MAX_UPLOAD_MB deve ficar entre 1 e 250.');
  if(production&&(!origin.startsWith('https://')||!scanner)) throw new Error('Produção exige APP_ORIGIN HTTPS e MALWARE_SCANNER configurado.');
  if(new URL(origin).origin!==origin) throw new Error('APP_ORIGIN deve conter apenas protocolo, host e porta, sem caminho.');
  mkdirSync(path.join(dataDir,'media'),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path.join(dataDir,'tvcorp.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,userId TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,previousHash TEXT NOT NULL,hash TEXT NOT NULL);
  `);
  const get=(kind,id)=>{ const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id); return r?JSON.parse(r.data):null; };
  const all=kind=>db.prepare('SELECT data FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.data));
  const put=(kind,item)=>db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,item.id,JSON.stringify(item));
  const remove=(kind,id)=>db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);
  const userById=id=>{const r=db.prepare('SELECT data FROM users WHERE id=?').get(id);return r?JSON.parse(r.data):null;};
  const userByEmail=value=>{const r=db.prepare('SELECT data FROM users WHERE email=?').get(value);return r?JSON.parse(r.data):null;};
  const users=()=>db.prepare('SELECT data FROM users').all().map(r=>JSON.parse(r.data));
  const saveUser=user=>db.prepare('INSERT INTO users(id,email,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,data=excluded.data').run(user.id,user.email,JSON.stringify(user));
  const audit=(actor,action,detail)=>{
    const previousHash=db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get()?.hash??'0'.repeat(64);
    const payload=JSON.stringify({at:now(),actor:actor?.email??actor??'system',action,detail});
    db.prepare('INSERT INTO audit(payload,previousHash,hash) VALUES(?,?,?)').run(payload,previousHash,sha(previousHash+payload));
  };
  if(!all('units').length) {
    [{id:'centro',name:'Unidade Centro',city:'Belo Horizonte · MG'},{id:'leste',name:'Unidade Leste',city:'Campinas · SP'},{id:'norte',name:'Vila Norte',city:'Unidade Vila Norte'},{id:'oeste',name:'Unidade Oeste',city:'São Paulo · SP'}].forEach(v=>put('units',v));
    [{id:'rh',name:'RH'},{id:'ti',name:'TI'},{id:'seguranca',name:'SEGURANÇA DO TRABALHO'},{id:'teste',name:'TESTE'}].forEach(v=>put('sectors',v));
  }
  const configured=()=>db.prepare('SELECT COUNT(*) AS count FROM users').get().count>0;
  const inScope=(user,item)=>user.role==='admin'||(user.unitIds.includes(item.unitId)&&user.sectorIds.includes(item.sectorId));
  const requireScope=(user,item)=>{if(!item) fail(404,'Registro não encontrado.');if(!inScope(user,item)) fail(403,'Acesso não permitido a esta unidade e setor.');return item;};
  const requireRole=(user,roles)=>{if(!roles.includes(user.role)) fail(403,'Seu perfil não permite esta ação.');};
  const scope=(user,body)=>{
    const unitId=label(body.unitId,80),sectorId=label(body.sectorId,80);
    if(!get('units',unitId)||!get('sectors',sectorId)) fail(400,'Unidade ou setor inválido.');
    requireScope(user,{unitId,sectorId});return {unitId,sectorId};
  };
  const validateAssignments=(unitIds,sectorIds)=>{
    if(!Array.isArray(unitIds)||!Array.isArray(sectorIds)||unitIds.length>50||sectorIds.length>50) fail(400,'Informe unidades e setores autorizados.');
    if(unitIds.some(id=>!get('units',id))||sectorIds.some(id=>!get('sectors',id))) fail(400,'Unidade ou setor inexistente.');
    return {unitIds:[...new Set(unitIds)],sectorIds:[...new Set(sectorIds)]};
  };
  const createAdmin=(name,address,password)=>{
    if(configured()) fail(409,'O administrador inicial já foi configurado.');
    const user={id:randomUUID(),name:label(name),email:email(address),password:passwordHash(validatePassword(password)),role:'admin',unitIds:all('units').map(x=>x.id),sectorIds:all('sectors').map(x=>x.id),active:true,createdAt:now()};
    saveUser(user);audit(user,'setup.admin.created',{userId:user.id});return publicUser(user);
  };
  const commitUserChange=(actor,next,{passwordReset=false,source='admin-api',profileChanged=true}={})=>{
    db.exec('BEGIN IMMEDIATE');
    try {
      saveUser(next);
      const revoked=db.prepare('DELETE FROM sessions WHERE userId=?').run(next.id).changes;
      if(profileChanged)audit(actor,'user.updated',{userId:next.id,role:next.role,active:next.active,unitIds:next.unitIds,sectorIds:next.sectorIds,passwordReset});
      if(passwordReset)audit(actor,'user.password.reset',{userId:next.id,source,sessionsRevoked:revoked});
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    return publicUser(next);
  };
  // Local server recovery only. This method is deliberately not exposed by an HTTP route.
  const resetAdminPassword=(address,password,operator='local-console')=>{
    const user=userByEmail(email(address));
    if(!user||!user.active||user.role!=='admin')fail(403,'A recuperação local exige uma conta administrativa existente e ativa.');
    const next={...user,password:passwordHash(validatePassword(password))};
    return commitUserChange(`local-console:${label(operator,160)}`,next,{passwordReset:true,source:'local-console',profileChanged:false});
  };
  const rates=new Map();
  const limit=(key,max,ms)=>{const current=Date.now();if(rates.size>5000) for(const [k,v]of rates) if(v.until<current) rates.delete(k);const entry=rates.get(key);if(!entry||entry.until<current){rates.set(key,{count:1,until:current+ms});return;}if(entry.count>=max)fail(429,'Muitas tentativas. Aguarde alguns minutos.');entry.count++;};
  const headers=(res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    res.setHeader('Cache-Control','no-store');if(production) res.setHeader('Strict-Transport-Security','max-age=31536000');
  };
  const json=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
  const read=async(req,max=64*1024)=>{
    if(Number(req.headers['content-length'])>max) fail(413,'Arquivo ou requisição excede o limite permitido.');
    const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>max) fail(413,'Arquivo ou requisição excede o limite permitido.');chunks.push(chunk);}return Buffer.concat(chunks);
  };
  const body=async req=>{if(!(req.headers['content-type']??'').startsWith('application/json'))fail(415,'Envie JSON.');try{const result=JSON.parse((await read(req)).toString('utf8'));if(!result||typeof result!=='object'||Array.isArray(result))fail(400,'Envie um objeto JSON válido.');return result;}catch(error){if(error.status)throw error;fail(400,'JSON inválido.');}};
  const session=req=>{
    const cookie=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pwc_session='))?.slice(12);
    if(!cookie)fail(401,'Entre com sua conta para continuar.');
    const s=db.prepare('SELECT * FROM sessions WHERE hash=?').get(sha(cookie));
    if(!s||s.expires<Date.now()){if(s)db.prepare('DELETE FROM sessions WHERE hash=?').run(s.hash);fail(401,'Sua sessão expirou. Entre novamente.');}
    const user=userById(s.userId);if(!user?.active)fail(401,'Conta desativada. Consulte a equipe de TI.');
    return {user,csrf:s.csrf,sessionHash:s.hash};
  };
  const loginSession=(res,user)=>{
    const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),user.id,csrf,Date.now()+8*60*60*1000);
    res.setHeader('Set-Cookie',`pwc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production?'; Secure':''}`);
    return {user:publicUser(user),csrf};
  };
  const verifyMutation=(req,ctx)=>{if(req.headers.origin&&req.headers.origin!==origin)fail(403,'Origem de requisição inválida.');if(!safeEqual(req.headers['x-csrf-token']??'',ctx.csrf))fail(403,'A sessão de segurança mudou. Atualize a página.');};
  const device=req=>{
    const value=req.headers.authorization??'';if(!value.startsWith('Bearer ')) fail(401,'Player não autenticado.');
    const hash=sha(value.slice(7));const d=all('displays').find(x=>x.tokenHash&&safeEqual(x.tokenHash,hash));if(!d||!d.active)fail(401,'Player revogado ou não pareado.');return d;
  };
  const displayPublic=d=>{const {tokenHash,pairHash,pairExpires,...rest}=d;return {...rest,status:d.lastSeen&&Date.now()-Date.parse(d.lastSeen)<90000?'online':'offline'};};
  const pairingCode=()=>{let code;do{code=String(randomInt(100000,1000000));}while(all('displays').some(d=>d.pairHash===sha(code)&&d.pairExpires>Date.now()));return code;};
  const mediaPublic=m=>{const {storageName,...rest}=m;return {...rest,url:`/api/media/${m.id}/file`};};
  const activePlaylists=d=>all('playlists').filter(p=>p.active&&p.displayIds.includes(d.id)&&p.unitId===d.unitId&&p.sectorId===d.sectorId&&(!p.startAt||Date.parse(p.startAt)<=Date.now())&&(!p.endAt||Date.parse(p.endAt)>Date.now()));
  const released=m=>m?.status==='approved'&&(!production||m.scanStatus==='clean');
  const deviceAllowed=(d,m)=>released(m)&&m.unitId===d.unitId&&m.sectorId===d.sectorId&&activePlaylists(d).some(p=>p.mediaIds.includes(m.id));

  const server=http.createServer(async(req,res)=>{
    headers(res);
    try {
      const url=new URL(req.url,origin),pathname=decodeURIComponent(url.pathname),method=req.method;
      if(method==='OPTIONS')return json(res,405,{error:'Método não permitido.'});
      if(pathname==='/api/status'&&method==='GET')return json(res,200,{configured:configured(),mode:production?'production':'local',setupEnabled:setupToken.length>=32&&!configured(),maxUploadMB:maxUpload/1024/1024,scannerConfigured:!!scanner});
      if(pathname==='/api/setup'&&method==='POST'){
        limit(`setup:${req.socket.remoteAddress}`,5,15*60000);
        const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if(!local||setupToken.length<32)fail(403,'Configuração inicial disponível somente no servidor com SETUP_TOKEN.');
        if(req.headers.origin&&req.headers.origin!==origin)fail(403,'Origem inválida.');
        const b=await body(req);if(!safeEqual(b.token??'',setupToken))fail(403,'Token de configuração inválido.');
        const u=createAdmin(b.name,b.email,b.password);return json(res,201,loginSession(res,u));
      }
      if(pathname==='/api/login'&&method==='POST'){
        if(req.headers.origin&&req.headers.origin!==origin)fail(403,'Origem inválida.');
        limit(`login:${req.socket.remoteAddress}`,12,15*60000);const b=await body(req);
        const address=typeof b.email==='string'?b.email.toLowerCase().trim():'';
        limit(`account:${address}`,12,15*60000);
        const user=userByEmail(address);
        const valid=passwordValid(typeof b.password==='string'?b.password.slice(0,129):'',user?.password??'00000000000000000000000000000000:0'.padEnd(161,'0'));
        if(!user||!user.active||!valid){audit('anonymous','auth.login.failed',{email:address.slice(0,254)});fail(401,'E-mail ou senha inválidos.');}
        audit(user,'auth.login',{});return json(res,200,loginSession(res,user));
      }
      if(pathname==='/api/player/pair'&&method==='POST'){
        limit(`pair:${req.socket.remoteAddress}`,6,15*60000);const b=await body(req);
        if(typeof b.code!=='string'||!/^\d{6}$/.test(b.code))fail(400,'Código de pareamento inválido.');
        const hash=sha(b.code);const d=all('displays').find(x=>x.active&&x.pairHash&&safeEqual(x.pairHash,hash)&&x.pairExpires>Date.now());
        if(!d)fail(400,'Código inválido ou expirado. Solicite outro à TI.');
        const token=randomBytes(32).toString('base64url');d.tokenHash=sha(token);delete d.pairHash;delete d.pairExpires;d.lastSeen=now();put('displays',d);audit(`player:${d.id}`,'device.paired',{});
        return json(res,200,{token,display:displayPublic(d)});
      }
      if(pathname==='/api/player/manifest'&&method==='GET'){
        const d=device(req),playlists=activePlaylists(d),items=[];let until=Date.now()+60000;
        for(const p of playlists){if(p.endAt)until=Math.min(until,Date.parse(p.endAt));for(const id of p.mediaIds){const m=get('media',id);if(deviceAllowed(d,m))items.push({id:m.id,title:m.title,name:m.name,type:m.type,url:`/api/media/${m.id}/file`,duration:p.duration});}}
        return json(res,200,{display:displayPublic(d),items,generatedAt:now(),validUntil:new Date(until).toISOString()});
      }
      if(pathname==='/api/player/heartbeat'&&method==='POST'){
        const d=device(req);d.lastSeen=now();put('displays',d);return json(res,200,{ok:true,serverTime:now()});
      }
      const fileMatch=pathname.match(/^\/api\/media\/([^/]+)\/file$/);
      if(fileMatch&&method==='GET'){
        const m=get('media',fileMatch[1]);if(!m)fail(404,'Arquivo não encontrado.');
        if(req.headers.authorization){const d=device(req);if(!deviceAllowed(d,m))fail(403,'Mídia indisponível para esta TV.');}
        else{const {user}=session(req);requireScope(user,m);}
        const file=path.join(dataDir,'media',m.storageName);if(!existsSync(file))fail(404,'Arquivo indisponível.');
        res.setHeader('Content-Type',m.type);res.setHeader('Content-Length',statSync(file).size);res.setHeader('Content-Disposition',`inline; filename="${m.id}${path.extname(m.storageName)}"`);res.end(readFileSync(file));return;
      }
      if(pathname.startsWith('/api/')){
        const ctx=session(req),user=ctx.user;if(!['GET','HEAD'].includes(method))verifyMutation(req,ctx);
        if(pathname==='/api/me'&&method==='GET')return json(res,200,{user:publicUser(user),csrf:ctx.csrf});
        if(pathname==='/api/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE hash=?').run(ctx.sessionHash);res.setHeader('Set-Cookie',`pwc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);return json(res,200,{ok:true});}
        if(pathname==='/api/state'&&method==='GET')return json(res,200,{
          units:all('units').filter(x=>user.role==='admin'||user.unitIds.includes(x.id)),sectors:all('sectors').filter(x=>user.role==='admin'||user.sectorIds.includes(x.id)),
          displays:all('displays').filter(x=>inScope(user,x)).map(displayPublic),media:all('media').filter(x=>inScope(user,x)).map(mediaPublic),playlists:all('playlists').filter(x=>inScope(user,x)),
          users:user.role==='admin'?users().map(publicUser):[],audit:user.role==='admin'?db.prepare('SELECT id,payload,previousHash,hash FROM audit ORDER BY id DESC LIMIT 200').all().map(x=>({id:x.id,...JSON.parse(x.payload),previousHash:x.previousHash,hash:x.hash})):[]
        });
        if(pathname==='/api/users'&&method==='POST'){
          requireRole(user,['admin']);const b=await body(req),address=email(b.email);if(userByEmail(address))fail(409,'Este e-mail já está cadastrado.');if(!ROLES.includes(b.role))fail(400,'Perfil inválido.');
          const u={id:randomUUID(),name:label(b.name),email:address,password:passwordHash(validatePassword(b.password)),role:b.role,...validateAssignments(b.unitIds??[],b.sectorIds??[]),active:true,createdAt:now()};saveUser(u);audit(user,'user.created',{userId:u.id,role:u.role,unitIds:u.unitIds,sectorIds:u.sectorIds});return json(res,201,publicUser(u));
        }
        const userMatch=pathname.match(/^\/api\/users\/([^/]+)$/);
        if(userMatch&&method==='PATCH'){
          requireRole(user,['admin']);const u=userById(userMatch[1]);if(!u)fail(404,'Usuário não encontrado.');const b=await body(req),next={...u};
          if(b.name!==undefined)next.name=label(b.name);if(b.role!==undefined){if(!ROLES.includes(b.role))fail(400,'Perfil inválido.');next.role=b.role;}
          if(b.active!==undefined){if(typeof b.active!=='boolean')fail(400,'Situação inválida.');next.active=b.active;}
          if(b.unitIds!==undefined||b.sectorIds!==undefined)Object.assign(next,validateAssignments(b.unitIds??u.unitIds,b.sectorIds??u.sectorIds));
          if(b.password!==undefined)next.password=passwordHash(validatePassword(b.password));
          if(u.role==='admin'&&u.active&&(!next.active||next.role!=='admin')&&users().filter(x=>x.active&&x.role==='admin').length<=1)fail(409,'Mantenha ao menos um administrador ativo.');
          const result=commitUserChange(user,next,{passwordReset:b.password!==undefined});
          if(u.id===user.id)res.setHeader('Set-Cookie',`pwc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);
          return json(res,200,result);
        }
        if(pathname==='/api/media'&&method==='POST'){
          requireRole(user,['admin','manager','editor']);const sc=scope(user,Object.fromEntries(url.searchParams));
          const name=label(url.searchParams.get('name'),200),title=label(url.searchParams.get('title')||name);if(name.includes('/')||name.includes('\\'))fail(400,'Nome de arquivo inválido.');const extension=path.extname(name).toLowerCase();
          if(!MIME[extension])fail(415,'Exporte o original como PNG, JPG, WebP, PDF, MP4 ou WebM. Arquivos Office, PSD, executáveis e macros não são reproduzidos diretamente.');
          const bytes=await read(req,maxUpload);if(!bytes.length||!signature(bytes,extension))fail(415,'O conteúdo não corresponde ao formato do arquivo.');
          const id=randomUUID(),storageName=id+extension,file=path.join(dataDir,'media',storageName);writeFileSync(file,bytes,{mode:0o600});
          let scanStatus='not_configured';
          if(scanner){try{await runFile(scanner,['--no-summary','--infected',file],{timeout:120000,maxBuffer:64*1024,windowsHide:true});scanStatus='clean';}catch{unlinkSync(file);audit(user,'media.scan.failed',{name});fail(422,'O arquivo não passou pela verificação de segurança. Consulte a TI.');}}
          const m={id,name,title,...sc,type:MIME[extension],size:bytes.length,sha256:sha(bytes),status:'pending',scanStatus,storageName,createdAt:now(),createdBy:user.id};put('media',m);audit(user,'media.uploaded',{mediaId:id,name,...sc,sha256:m.sha256,scanStatus});return json(res,201,mediaPublic(m));
        }
        const mediaAction=pathname.match(/^\/api\/media\/([^/]+)\/(approve|reject)$/);
        if(mediaAction&&method==='POST'){
          requireRole(user,['admin','manager']);const m=requireScope(user,get('media',mediaAction[1])),b=await body(req);
          if(mediaAction[2]==='approve'&&m.scanStatus!=='clean'&&(production||b.acknowledgeUnscanned!==true))fail(409,'Verificação antivírus indisponível. Em ambiente local, a aprovação exige confirmação explícita.');
          m.status=mediaAction[2]==='approve'?'approved':'rejected';m.reviewedAt=now();m.reviewedBy=user.id;put('media',m);audit(user,`media.${m.status}`,{mediaId:m.id,scanStatus:m.scanStatus,localUnscannedAcknowledged:b.acknowledgeUnscanned===true});return json(res,200,mediaPublic(m));
        }
        if(pathname==='/api/displays'&&method==='POST'){
          requireRole(user,['admin']);const b=await body(req),code=pairingCode();
          const d={id:randomUUID(),name:label(b.name),...scope(user,b),active:true,createdAt:now(),lastSeen:null,pairHash:sha(code),pairExpires:Date.now()+600000};put('displays',d);audit(user,'device.created',{displayId:d.id,...scope(user,b)});return json(res,201,{display:displayPublic(d),pairingCode:code,expiresAt:new Date(d.pairExpires).toISOString()});
        }
        const displayMatch=pathname.match(/^\/api\/displays\/([^/]+)(\/pairing)?$/);
        if(displayMatch&&method==='POST'&&displayMatch[2]){
          requireRole(user,['admin']);const d=requireScope(user,get('displays',displayMatch[1])),code=pairingCode();d.pairHash=sha(code);d.pairExpires=Date.now()+600000;delete d.tokenHash;put('displays',d);audit(user,'device.pairing.renewed',{displayId:d.id});return json(res,200,{display:displayPublic(d),pairingCode:code,expiresAt:new Date(d.pairExpires).toISOString()});
        }
        if(displayMatch&&method==='DELETE'&&!displayMatch[2]){
          requireRole(user,['admin']);const d=requireScope(user,get('displays',displayMatch[1]));
          db.exec('BEGIN IMMEDIATE');
          try {remove('displays',d.id);for(const p of all('playlists'))if(p.displayIds.includes(d.id)){p.displayIds=p.displayIds.filter(id=>id!==d.id);if(!p.displayIds.length)p.active=false;put('playlists',p);}audit(user,'device.revoked',{displayId:d.id});db.exec('COMMIT');}
          catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,200,{ok:true});
        }
        if(pathname==='/api/playlists'&&method==='POST'){
          requireRole(user,['admin','manager']);const b=await body(req),sc=scope(user,b);
          if(!Array.isArray(b.mediaIds)||!b.mediaIds.length||b.mediaIds.length>100||!Array.isArray(b.displayIds)||!b.displayIds.length||b.displayIds.length>200)fail(400,'Selecione conteúdos e TVs para publicar.');
          for(const id of b.mediaIds){const m=requireScope(user,get('media',id));if(!released(m)||m.unitId!==sc.unitId||m.sectorId!==sc.sectorId)fail(400,'Todos os conteúdos precisam estar aprovados, liberados pela política antimalware e pertencer à mesma unidade e setor.');}
          for(const id of b.displayIds){const d=requireScope(user,get('displays',id));if(!d.active||d.unitId!==sc.unitId||d.sectorId!==sc.sectorId)fail(400,'Selecione TVs ativas da mesma unidade e setor.');}
          const startAt=parseTime(b.startAt),endAt=parseTime(b.endAt);if(endAt&&Date.parse(endAt)<=(startAt?Date.parse(startAt):Date.now()))fail(400,'O término deve ser posterior ao início e ao momento atual.');
          const duration=Number(b.duration??15);if(!Number.isInteger(duration)||duration<5||duration>3600)fail(400,'A duração deve ficar entre 5 e 3600 segundos.');
          const p={id:randomUUID(),name:label(b.name),...sc,mediaIds:[...new Set(b.mediaIds)],displayIds:[...new Set(b.displayIds)],startAt,endAt,duration,active:true,createdBy:user.id,createdAt:now()};put('playlists',p);audit(user,'playlist.published',{playlistId:p.id,...sc,displayIds:p.displayIds,mediaIds:p.mediaIds,startAt,endAt});return json(res,201,p);
        }
        const playlistMatch=pathname.match(/^\/api\/playlists\/([^/]+)$/);
        if(playlistMatch&&method==='DELETE'){
          requireRole(user,['admin','manager']);const p=requireScope(user,get('playlists',playlistMatch[1]));p.active=false;put('playlists',p);audit(user,'playlist.stopped',{playlistId:p.id});return json(res,200,{ok:true});
        }
        const orgMatch=pathname.match(/^\/api\/(units|sectors)(?:\/([^/]+))?$/);
        if(orgMatch&&['POST','PATCH'].includes(method)){
          requireRole(user,['admin']);const b=await body(req),kind=orgMatch[1];
          if(method==='PATCH'&&!get(kind,orgMatch[2]))fail(404,'Registro inexistente.');
          const item={id:method==='PATCH'?orgMatch[2]:randomUUID(),name:label(b.name)};if(kind==='units')item.city=typeof b.city==='string'?b.city.slice(0,120):'';put(kind,item);audit(user,`${kind}.saved`,{id:item.id,name:item.name});return json(res,method==='POST'?201:200,item);
        }
        fail(404,'Endpoint não encontrado.');
      }
      if(!['GET','HEAD'].includes(method))fail(405,'Método não permitido.');
      const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,'public',relative),publicRoot=path.resolve(root,'public');
      if(!file.startsWith(publicRoot+path.sep)||relative.split(/[\\/]/).some(v=>v.startsWith('.')))fail(404,'Página não encontrada.');
      if(!existsSync(file)||!statSync(file).isFile())fail(404,'Página não encontrada.');
      const extension=path.extname(file).toLowerCase();if(!STATIC_MIME[extension])fail(404,'Arquivo indisponível.');res.setHeader('Content-Type',STATIC_MIME[extension]);res.statusCode=200;res.end(method==='HEAD'?undefined:readFileSync(file));
    } catch(error) {
      if(!res.headersSent)json(res,error.status??500,{error:error.status?error.message:'Falha interna. Consulte a equipe de TI.'});else res.end();
      if(!error.status)console.error('Falha interna:',error.message);
    }
  });
  server.requestTimeout=150000;server.headersTimeout=10000;server.maxHeadersCount=50;
  const close=()=>new Promise(resolve=>{if(!server.listening){db.close();resolve();return;}server.close(()=>{db.close();resolve();});server.closeIdleConnections();});
  return {server,close,configured,createAdmin,resetAdminPassword,config:{port,host,origin,dataDir,production},db};
}
