import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { hasPermission, inScope } from './permissions.mjs';
import { nowIso } from '../lib/validate.mjs';

export function requireDisplayAdmin(actor){if(!actor?.active||actor.role!=='admin')fail(403,'Somente administradores podem gerenciar TVs e seus acessos.','ADMIN_REQUIRED');}

export function createDisplayAccess({db,tx,audit}) {
  const user=id=>{const row=db.prepare('SELECT data FROM users WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
  const grants=id=>db.prepare('SELECT * FROM display_grants WHERE display_id=? AND active=1 ORDER BY principal_type,principal_id').all(id);
  function mayUse(actor,display,sectorId){
    if(!actor?.active||!display||display.removed_at)return false;
    if(actor.role==='admin')return true;
    if(!(actor.unitIds??[]).includes(display.unit_id))return false;
    const sectors=sectorId?[sectorId]:(actor.sectorIds??[]);
    return sectors.some(sector=>(actor.sectorIds??[]).includes(sector)&&grants(display.id).some(g=>g.principal_type==='user'?g.principal_id===actor.id:g.principal_id===sector));
  }
  const mayPublish=(actor,display,sectorId)=>hasPermission(actor,'schedule:publish')&&mayUse(actor,display,sectorId);
  function reason(link){
    const display=db.prepare('SELECT * FROM displays WHERE id=?').get(link.display_id);
    if(!display||display.removed_at)return 'TV revogada';
    if(display.unit_id!==link.unit_id)return 'A TV foi transferida para outra unidade';
    if(link.legacy_authorized===1&&!link.authorized_by){
      return grants(display.id).some(g=>g.principal_type==='sector'&&g.principal_id===link.sector_id)?null:'Concessão do setor legado revogada';
    }
    const actor=user(link.authorized_by);
    if(!actor?.active)return 'Responsável inexistente ou desativado';
    if(!inScope(actor,{unitId:link.unit_id,sectorId:link.sector_id}))return 'Responsável sem acesso à unidade e ao setor';
    if(!hasPermission(actor,link.schedule_status==='draft'?'schedule:create':'schedule:publish'))return 'Responsável sem permissão para programar';
    if(!mayUse(actor,display,link.sector_id))return 'Acesso à TV revogado';
    return null;
  }
  const allLinks=()=>db.prepare(`SELECT sd.*,s.unit_id,s.sector_id,s.status AS schedule_status FROM schedule_displays sd JOIN schedules s ON s.id=sd.schedule_id WHERE sd.link_status='active'`).all();
  function history(scheduleId,displayId,action,actorId,detail={}){
    db.prepare('INSERT INTO schedule_display_history(schedule_id,display_id,action,actor_id,at,detail) VALUES(?,?,?,?,?,?)').run(scheduleId,displayId,action,actorId??null,nowIso(),JSON.stringify(detail));
  }
  function suspend(link,why,actor='system'){
    const changed=db.prepare("UPDATE schedule_displays SET link_status='suspended',suspended_at=?,suspension_reason=? WHERE schedule_id=? AND display_id=? AND link_status='active'").run(nowIso(),why,link.schedule_id,link.display_id).changes;
    if(changed){db.prepare('UPDATE displays SET order_rev=order_rev+1 WHERE id=?').run(link.display_id);history(link.schedule_id,link.display_id,'suspended',actor?.id??null,{reason:why});audit.record(actor,'display.link.suspended',{displayId:link.display_id,scheduleId:link.schedule_id,reason:why},{unitId:link.unit_id,sectorId:link.sector_id});}
  }
  function reconcile(actor='system'){
    tx(()=>{for(const link of allLinks()){const why=reason(link);if(why)suspend(link,why,actor);}});
  }
  function replaceGrants(display,sectorIds,userIds,actor){
    const wanted=new Set([...sectorIds.map(id=>'sector:'+id),...userIds.map(id=>'user:'+id)]);
    for(const grant of grants(display.id))if(!wanted.delete(grant.principal_type+':'+grant.principal_id))db.prepare('UPDATE display_grants SET active=0,revoked_at=?,revoked_by=? WHERE id=?').run(nowIso(),actor.id,grant.id);
    for(const key of wanted){const colon=key.indexOf(':');db.prepare('INSERT INTO display_grants(id,display_id,principal_type,principal_id,created_at,created_by) VALUES(?,?,?,?,?,?)').run(randomUUID(),display.id,key.slice(0,colon),key.slice(colon+1),nowIso(),actor.id);}
    reconcile(actor);
  }
  function bind(scheduleId,displayIds,actor,{reauthorize=true}={}){
    const existing=db.prepare('SELECT * FROM schedule_displays WHERE schedule_id=?').all(scheduleId);
    for(const link of existing)if(!displayIds.includes(link.display_id)&&link.link_status!=='removed'){
      db.prepare("UPDATE schedule_displays SET link_status='removed',suspended_at=?,suspension_reason='Destino retirado da programação' WHERE schedule_id=? AND display_id=?").run(nowIso(),scheduleId,link.display_id);
      db.prepare('UPDATE displays SET order_rev=order_rev+1 WHERE id=?').run(link.display_id);history(scheduleId,link.display_id,'removed',actor.id);
    }
    for(const displayId of displayIds){
      const old=existing.find(x=>x.display_id===displayId);
      if(old){if(reauthorize||old.link_status==='removed'){db.prepare("UPDATE schedule_displays SET link_status='active',authorized_by=?,legacy_authorized=0,suspended_at=NULL,suspension_reason=NULL WHERE schedule_id=? AND display_id=?").run(actor.id,scheduleId,displayId);history(scheduleId,displayId,'authorized',actor.id);}}
      else {const position=db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM schedule_displays WHERE display_id=?').get(displayId).n;db.prepare('INSERT INTO schedule_displays(schedule_id,display_id,position,authorized_by,linked_at) VALUES(?,?,?,?,?)').run(scheduleId,displayId,position,actor.id,nowIso());history(scheduleId,displayId,'linked',actor.id);}
      db.prepare('UPDATE displays SET order_rev=order_rev+1 WHERE id=?').run(displayId);
    }
  }
  function activeLinks(display){
    reconcile();
    return db.prepare(`SELECT sd.*,s.unit_id,s.sector_id,s.id,s.name,s.playlist_id,s.playlist_version,s.status,s.start_at,s.end_at,s.published_at
      FROM schedule_displays sd JOIN schedules s ON s.id=sd.schedule_id WHERE sd.display_id=? AND sd.link_status='active' AND s.status='published'
      ORDER BY sd.position,s.published_at,s.id`).all(display.id).filter(link=>!reason(link));
  }
  return {user,grants,mayUse,mayPublish,reason,reconcile,replaceGrants,bind,activeLinks,suspend,history};
}
