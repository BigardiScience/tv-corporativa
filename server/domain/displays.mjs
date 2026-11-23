import { randomUUID, randomInt } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { sha } from '../lib/crypto.mjs';
import { idList,label,nowIso,safeId } from '../lib/validate.mjs';
import { authorize,inScope,hasPermission } from './permissions.mjs';
import { requireDisplayAdmin } from './display-access.mjs';

export const ONLINE_WINDOW_MS=90000,PAIRING_WINDOW_MS=600000;
const scopeOf=row=>({unitId:row.unit_id,sectorId:row.sector_id});

export function createDisplays({db,tx,audit,organization,access}) {
  const find=id=>typeof id==='string'&&id.length<=80?db.prepare('SELECT * FROM displays WHERE id=?').get(id):undefined;
  const load=id=>{const row=find(id);if(!row||row.removed_at)fail(404,'TV não encontrada.');return row;};
  function dto(row,extra={},actor=null){
    const now=Date.now(),grants=access.grants(row.id);
    const online=row.status==='active'&&!row.removed_at&&row.last_seen&&now-Date.parse(row.last_seen)<ONLINE_WINDOW_MS;
    return {id:row.id,unitId:row.unit_id,sectorId:row.sector_id,name:row.name,status:row.removed_at?'revoked':row.status,
      sectorIds:grants.filter(g=>g.principal_type==='sector').map(g=>g.principal_id),
      userIds:actor?.role==='admin'?grants.filter(g=>g.principal_type==='user').map(g=>g.principal_id):[],
      shared:true,accessRev:row.access_rev,orderRev:row.order_rev,
      permissions:{view:!!actor&&access.mayUse(actor,row),publish:!!actor&&(hasPermission(actor,'schedule:create')||hasPermission(actor,'schedule:publish'))&&access.mayUse(actor,row),manage:actor?.role==='admin',pair:!!actor&&hasPermission(actor,'screen:pair')&&access.mayUse(actor,row)},
      connection:row.status!=='active'||row.removed_at?'inactive':online?'online':'offline',lastSeen:row.last_seen,
      createdAt:row.created_at,createdBy:row.created_by,activatedAt:row.activated_at,activatedBy:row.activated_by,
      paired:!!row.token_hash,pairingOpen:!!row.pair_hash&&row.pair_expires>now,playerVersion:row.player_version??null,...extra};
  }
  function openPairing(id){let code;do{code=String(randomInt(100000,1000000));}while(db.prepare('SELECT 1 FROM displays WHERE pair_hash=? AND pair_expires>?').get(sha(code),Date.now()));const expires=Date.now()+PAIRING_WINDOW_MS;db.prepare('UPDATE displays SET pair_hash=?,pair_expires=? WHERE id=?').run(sha(code),expires,id);return {pairingCode:code,expiresAt:new Date(expires).toISOString()};}
  function sharedWithSector(display,sectorId){return access.grants(display.id).some(g=>g.principal_type==='sector'?g.principal_id===sectorId:(access.user(g.principal_id)?.sectorIds??[]).includes(sectorId));}
  function list(actor,query={}){
    access.reconcile();
    if(query.unitId)safeId(query.unitId,'Unidade inválida.');if(query.sectorId)safeId(query.sectorId,'Setor inválido.');
    const rows=db.prepare('SELECT * FROM displays WHERE removed_at IS NULL ORDER BY name COLLATE NOCASE,id').all().filter(row=>(!query.unitId||row.unit_id===query.unitId)&&(!query.sectorId||sharedWithSector(row,query.sectorId)||actor.role!=='admin'&&access.mayUse(actor,row,query.sectorId))&&access.mayUse(actor,row,query.sectorId));
    return {displays:rows.map(row=>dto(row,{activeSchedules:sequenceRows(actor,row).filter(s=>s.state==='live'&&s.linkStatus==='active').map(s=>({id:s.id,name:s.name,sectorId:s.sectorId}))},actor))};
  }
  function assignments(body,unitId,current=null){
    const old=current?access.grants(current.id):[];
    const sectorIds=idList(body.sectorIds??(current?old.filter(g=>g.principal_type==='sector').map(g=>g.principal_id):body.sectorId?[body.sectorId]:[]));
    const userIds=idList(body.userIds??(current?old.filter(g=>g.principal_type==='user').map(g=>g.principal_id):[]));
    if(sectorIds.some(id=>!organization.sectorExists(id)))fail(400,'Setor autorizado inválido.');
    for(const id of userIds){const user=access.user(id);if(!user?.active||(user.role!=='admin'&&!(user.unitIds??[]).includes(unitId)))fail(400,'Selecione usuários ativos com acesso à unidade da TV.','INVALID_DISPLAY_GRANT');}
    return {sectorIds,userIds};
  }
  function create(actor,body){
    requireDisplayAdmin(actor);const unitId=safeId(body.unitId,'Unidade inválida.');if(!organization.unitExists(unitId))fail(400,'Unidade inválida.');
    const name=label(body.name),{sectorIds,userIds}=assignments(body,unitId),legacySector=sectorIds[0]??organization.sectors()[0]?.id;
    if(!legacySector)fail(400,'Cadastre ao menos um setor antes da TV.');
    const id=randomUUID(),at=nowIso();let pairing;
    tx(()=>{db.prepare("INSERT INTO displays(id,unit_id,sector_id,name,status,created_at,created_by,activated_at,activated_by) VALUES(?,?,?,?,'active',?,?,?,?)").run(id,unitId,legacySector,name,at,actor.id,at,actor.id);access.replaceGrants(find(id),sectorIds,userIds,actor);pairing=openPairing(id);audit.record(actor,'device.created',{displayId:id,name,status:'active',unitId,sectorIds,userIds});audit.record(actor,'device.activated',{displayId:id,name},{unitId,sectorId:legacySector});});
    return {display:dto(find(id),{},actor),...pairing};
  }
  function activate(actor,id){requireDisplayAdmin(actor);const row=load(id);if(row.status!=='pending')fail(409,'Esta TV já está ativa.','ALREADY_ACTIVE');let pairing;tx(()=>{db.prepare("UPDATE displays SET status='active',activated_at=?,activated_by=? WHERE id=?").run(nowIso(),actor.id,id);pairing=openPairing(id);audit.record(actor,'device.activated',{displayId:id,name:row.name,registeredBy:row.created_by},scopeOf(row));});return {display:dto(find(id),{},actor),...pairing};}
  function renewPairing(actor,id){requireDisplayAdmin(actor);const row=load(id);if(row.status!=='active')fail(409,'Ative a TV antes de gerar um código de pareamento.','NOT_ACTIVE');let pairing;tx(()=>{db.prepare('UPDATE displays SET token_hash=NULL WHERE id=?').run(id);pairing=openPairing(id);audit.record(actor,'device.pairing.renewed',{displayId:id,name:row.name},scopeOf(row));});return {display:dto(find(id),{},actor),...pairing};}
  // Código de pareamento para uma TV já cadastrada e ativa, por quem tem a permissão própria (Editor e Gestor) e acesso àquela TV. Só abre o código:
  // não desconecta a TV nem revoga a credencial dela (isso só acontece quando o código é usado em /api/player/pair). O código nunca vai para a auditoria.
  function generatePairingCode(actor,id){authorize(actor,'screen:pair');const row=load(id);if(!access.mayUse(actor,row))fail(403,'Sem acesso a esta TV.','DISPLAY_ACCESS_DENIED');if(row.status!=='active')fail(409,'Ative a TV antes de gerar um código de pareamento.','NOT_ACTIVE');let pairing;tx(()=>{pairing=openPairing(id);audit.record(actor,'device.pairing.generated',{displayId:id,name:row.name},scopeOf(row));});return {display:dto(find(id),{},actor),...pairing};}
  function update(actor,id,body){
    requireDisplayAdmin(actor);const row=load(id),changesAccess=body.sectorIds!==undefined||body.userIds!==undefined||body.unitId!==undefined;
    if((changesAccess||body.rev!==undefined)&&body.rev!==row.access_rev)fail(409,'Os acessos desta TV foram alterados. Atualize e tente novamente.','REVISION_CONFLICT',{currentRev:row.access_rev});
    const name=body.name===undefined?row.name:label(body.name),unitId=body.unitId===undefined?row.unit_id:safeId(body.unitId,'Unidade inválida.');
    if(!organization.unitExists(unitId))fail(400,'Unidade inválida.');
    const moved=unitId!==row.unit_id;if(moved&&(body.sectorIds===undefined||body.userIds===undefined))fail(400,'Ao transferir a TV, informe novamente os setores e usuários autorizados.');
    const {sectorIds,userIds}=assignments(body,unitId,row);
    tx(()=>{
      const changed=db.prepare('UPDATE displays SET name=?,unit_id=?,access_rev=access_rev+1 WHERE id=? AND access_rev=?').run(name,unitId,id,row.access_rev).changes;
      if(!changed)fail(409,'A TV foi alterada por outra pessoa.','REVISION_CONFLICT');
      if(changesAccess)access.replaceGrants(find(id),sectorIds,userIds,actor);
      if(name!==row.name)audit.record(actor,'device.renamed',{displayId:id,from:row.name,to:name},scopeOf(row));
      // Concessões pessoais são administrativas: sem escopo de setor no evento, a lista de usuários fica só com o admin.
      if(changesAccess)audit.record(actor,'device.access.updated',{displayId:id,fromUnitId:row.unit_id,unitId,sectorIds,userIds});
    });return dto(find(id),{},actor);
  }
  function remove(actor,id){requireDisplayAdmin(actor);const row=load(id);tx(()=>{db.prepare('UPDATE displays SET removed_at=?,token_hash=NULL,pair_hash=NULL,pair_expires=NULL,access_rev=access_rev+1 WHERE id=?').run(nowIso(),id);access.reconcile(actor);audit.record(actor,'device.revoked',{displayId:id,name:row.name},scopeOf(row));});return {ok:true};}
  function sequenceRows(actor,row){
    const time=Date.now();return db.prepare(`SELECT sd.*,s.*,sd.position AS queue_position FROM schedule_displays sd JOIN schedules s ON s.id=sd.schedule_id WHERE sd.display_id=? AND sd.link_status!='removed' ORDER BY sd.position,s.published_at,s.id`).all(row.id).map(s=>{
      const accessible=inScope(actor,{unitId:s.unit_id,sectorId:s.sector_id});
      const totals=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(i.duration_s),0) AS seconds FROM playlist_version_items i JOIN playlist_versions v ON v.id=i.version_id WHERE v.playlist_id=? AND v.version=?').get(s.playlist_id,s.playlist_version);
      const state=s.status!=='published'?s.status:s.start_at&&Date.parse(s.start_at)>time?'scheduled':s.end_at&&Date.parse(s.end_at)<=time?'expired':'live';
      return {id:s.id,name:accessible?s.name:'Programação de outro setor',sectorId:s.sector_id,sectorName:db.prepare('SELECT name FROM sectors WHERE id=?').get(s.sector_id)?.name??'Setor',position:s.queue_position,status:s.status,state,itemCount:totals.n,durationSeconds:totals.seconds,accessible,linkStatus:s.link_status,suspensionReason:s.suspension_reason??null};
    });
  }
  function sequence(actor,id){const row=load(id);if(!access.mayUse(actor,row))fail(403,'Sem acesso a esta TV.','DISPLAY_ACCESS_DENIED');access.reconcile();const current=load(id);return {display:dto(current,{},actor),revision:current.order_rev,schedules:sequenceRows(actor,current),items:[]};}
  function order(actor,id,body){
    requireDisplayAdmin(actor);const row=load(id);access.reconcile();const current=load(id);
    if(body.rev!==current.order_rev)fail(409,'A sequência desta TV mudou. Atualize e tente novamente.','REVISION_CONFLICT',{currentRev:current.order_rev});
    const currentIds=sequenceRows(actor,current).map(s=>s.id);
    if(!Array.isArray(body.scheduleIds))fail(400,'Envie a lista de programações da fila.','QUEUE_MISMATCH');
    const ids=idList(body.scheduleIds,{max:Math.max(200,currentIds.length)});
    if(ids.length!==body.scheduleIds.length||ids.length!==currentIds.length||ids.some(id=>!currentIds.includes(id)))fail(400,'Envie todas as programações da fila exatamente uma vez.','QUEUE_MISMATCH');
    tx(()=>{if(!db.prepare('UPDATE displays SET order_rev=order_rev+1 WHERE id=? AND order_rev=?').run(id,body.rev).changes)fail(409,'A sequência mudou.','REVISION_CONFLICT');ids.forEach((scheduleId,position)=>db.prepare('UPDATE schedule_displays SET position=? WHERE schedule_id=? AND display_id=?').run(position,scheduleId,id));audit.record(actor,'device.queue.reordered',{displayId:id,scheduleIds:ids},scopeOf(row));});return sequence(actor,id);
  }
  return {find,load,dto,list,create,activate,renewPairing,generatePairingCode,update,rename:(actor,id,name)=>update(actor,id,{name}),remove,sequence,order};
}
