import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, must, PASSWORD } from './helpers/app.mjs';

const manifest = async (k,tv) => must(await k.call('/api/player/manifest',{token:tv.token})).items.map(i=>i.id);
const sequence = async (k,tv,session=k.admin) => must(await k.call(`/api/displays/${tv.display.id}/sequence`,{session}));
async function sharedTv(k,body={}) {
  const created=must(await k.call('/api/displays',{method:'POST',session:k.admin,body:{name:'TV compartilhada',unitId:'leste',sectorIds:['rh','ti'],userIds:[],...body}}),201);
  const paired=must(await k.call('/api/player/pair',{method:'POST',body:{code:created.pairingCode}}));
  return {...created,token:paired.token};
}
async function material(k,person,sectorId='rh') {
  const media=await k.approvedMedia(person.session,{sectorId,title:`Confidencial ${sectorId}`,name:`privado-${sectorId}.png`});
  const playlist=await k.publishedPlaylist(k.admin,[media.id],{sectorId});
  return {media,playlist,body:{name:`Agenda reservada ${sectorId}`,unitId:'leste',sectorId,playlistId:playlist.id,publish:true}};
}
async function grant(k,tv,sectorIds,userIds=[]) {
  const current=await sequence(k,tv);
  return must(await k.call(`/api/displays/${tv.display.id}`,{method:'PATCH',session:k.admin,body:{rev:current.display.accessRev,sectorIds,userIds}}));
}

test('TV única reúne publicações concorrentes de RH/TI sem conceder acesso às mídias entre setores',async()=>{
  await withApp(async k=>{
    const rh=await k.createUser('manager'),ti=await k.createUser('manager',{sectorIds:['ti']});
    const tv=await sharedTv(k),a=await material(k,rh),b=await material(k,ti,'ti');
    const results=await Promise.all([k.call('/api/schedules',{method:'POST',session:rh.session,body:{...a.body,displayIds:[tv.display.id]}}),k.call('/api/schedules',{method:'POST',session:ti.session,body:{...b.body,displayIds:[tv.display.id]}})]);
    const schedules=results.map(r=>must(r,201));
    assert.deepEqual((await manifest(k,tv)).sort(),[a.media.id,b.media.id].sort());
    assert.equal(k.app.db.prepare('SELECT COUNT(*) AS n FROM displays').get().n,1);
    for(const route of [`/api/media/${b.media.id}`,`/api/media/${b.media.id}/file`,`/api/playlists/${b.playlist.id}`,`/api/schedules/${schedules[1].id}`,'/api/library?unitId=leste&sectorId=ti'])assert.equal((await k.call(route,{session:rh.session})).status,403,route);
    const preview=await sequence(k,tv,rh.session),serialized=JSON.stringify(preview);
    assert.equal(preview.schedules.length,2);assert.deepEqual(preview.items,[]);
    assert.equal(preview.schedules.find(s=>s.sectorId==='ti').name,'Programação de outro setor');
    for(const secret of [b.media.id,b.media.title,b.media.name,b.playlist.id,b.body.name,'/api/media/'])assert.ok(!serialized.includes(secret),secret);
    assert.equal((await k.call(`/api/media/${b.media.id}/file`,{token:tv.token})).status,200,'apenas a credencial física toca ambos');
    assert.equal((await k.call(`/api/schedules/${schedules[1].id}`,{method:'PATCH',session:rh.session,body:{rev:1,name:'Invasão'}})).status,403);
  });
});

test('ordem exclusiva do administrador usa CAS e preserva novas publicações concorrentes',async()=>{
  await withApp(async k=>{
    const rh=await k.createUser('manager'),tv=await sharedTv(k),a=await material(k,rh),b=await material(k,rh);
    const first=await k.liveSchedule(rh.session,{playlistId:a.playlist.id,displayIds:[tv.display.id],name:'Primeira'});
    const second=await k.liveSchedule(rh.session,{playlistId:b.playlist.id,displayIds:[tv.display.id],name:'Segunda'});
    const before=await sequence(k,tv),order=[second.id,first.id];
    const put=(session,rev,scheduleIds)=>k.call(`/api/displays/${tv.display.id}/order`,{method:'PUT',session,body:{rev,scheduleIds}});
    assert.equal((await put(rh.session,before.revision,order)).status,403);
    assert.equal((await put(k.admin,before.revision,[first.id,first.id])).status,400);
    assert.equal((await put(k.admin,before.revision,undefined)).status,400);
    const responses=await Promise.all([put(k.admin,before.revision,order),put(k.admin,before.revision,[first.id,second.id])]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const ordered=await sequence(k,tv);assert.deepEqual(ordered.schedules.map(s=>s.id),order);
    assert.deepEqual(await manifest(k,tv),[b.media.id,a.media.id],'manifesto segue a ordem administrativa');
    const third=await k.liveSchedule(rh.session,{playlistId:a.playlist.id,displayIds:[tv.display.id],name:'Terceira'});
    assert.equal((await put(k.admin,ordered.revision,order)).data.code,'REVISION_CONFLICT');
    assert.deepEqual((await sequence(k,tv)).schedules.map(s=>s.id),[...order,third.id]);
    assert.deepEqual(await manifest(k,tv),[b.media.id,a.media.id,a.media.id]);
  });
});

test('revogar setor suspende somente seus vínculos, preserva histórico e exige republicação explícita',async()=>{
  await withApp(async k=>{
    const rh=await k.createUser('manager'),ti=await k.createUser('manager',{sectorIds:['ti']});
    const tv=await sharedTv(k),a=await material(k,rh),b=await material(k,ti,'ti');
    const s=await k.liveSchedule(rh.session,{playlistId:a.playlist.id,displayIds:[tv.display.id]});
    await k.liveSchedule(ti.session,{playlistId:b.playlist.id,displayIds:[tv.display.id],sectorId:'ti'});
    // Uma edição administrativa não transforma publicação de RH em autorização universal de administrador.
    const edited=must(await k.call(`/api/schedules/${s.id}`,{method:'PATCH',session:k.admin,body:{rev:s.rev,name:'Nome corrigido'}}));
    assert.equal(k.app.db.prepare('SELECT authorized_by FROM schedule_displays WHERE schedule_id=?').get(s.id).authorized_by,rh.user.id);
    await grant(k,tv,['ti']);assert.deepEqual(await manifest(k,tv),[b.media.id]);
    assert.equal((await k.call(`/api/media/${a.media.id}/file`,{token:tv.token})).status,403);
    assert.equal((await sequence(k,tv)).schedules.find(x=>x.id===s.id).linkStatus,'suspended');
    assert.ok(k.app.db.prepare("SELECT 1 FROM schedule_display_history WHERE schedule_id=? AND action='suspended'").get(s.id));
    await grant(k,tv,['rh','ti']);assert.deepEqual(await manifest(k,tv),[b.media.id],'restaurar concessão não ressuscita vínculo');
    must(await k.call(`/api/schedules/${s.id}`,{method:'PATCH',session:k.admin,body:{rev:edited.rev,name:'Ajuste sem retomada'}}));
    assert.deepEqual(await manifest(k,tv),[b.media.id]);
    must(await k.call(`/api/schedules/${s.id}/stop`,{method:'POST',session:rh.session}));
    must(await k.call(`/api/schedules/${s.id}/publish`,{method:'POST',session:rh.session,body:{}}));
    assert.deepEqual(await manifest(k,tv),[a.media.id,b.media.id]);
  });
});

test('concessão individual continua intersectada com unidade, setor e permissão funcional',async()=>{
  await withApp(async k=>{
    const allowed=await k.createUser('manager'),other=await k.createUser('manager'),viewer=await k.createUser('viewer');
    const tv=await sharedTv(k,{sectorIds:[],userIds:[allowed.user.id,viewer.user.id]}),a=await material(k,allowed);
    const send=session=>k.call('/api/schedules',{method:'POST',session,body:{...a.body,displayIds:[tv.display.id]}});
    assert.equal((await send(other.session)).data.code,'DISPLAY_ACCESS_DENIED');
    assert.equal((await send(viewer.session)).status,403);
    assert.equal((await sequence(k,tv,viewer.session)).display.permissions.publish,false);
    must(await send(allowed.session),201);
    assert.equal((await k.call('/api/displays',{session:other.session})).data.displays.length,0);
    // Fora da unidade, nem a lista de concessões aceita a pessoa.
    const foreign=await k.createUser('manager',{unitIds:['centro']});
    const current=await sequence(k,tv);
    assert.equal((await k.call(`/api/displays/${tv.display.id}`,{method:'PATCH',session:k.admin,body:{rev:current.display.accessRev,sectorIds:[],userIds:[foreign.user.id]}})).data.code,'INVALID_DISPLAY_GRANT');
    const draftUser=await k.createUser('editor',{revokes:['schedule:publish']});
    await grant(k,tv,[],[allowed.user.id,draftUser.user.id]);
    const scopedAudit=must(await k.call('/api/audit?limit=500',{session:allowed.session})).events;
    assert.ok(!scopedAudit.some(e=>e.action==='device.created'||e.action==='device.access.updated'),'detalhes de concessões individuais ficam na auditoria administrativa');
    assert.ok(!JSON.stringify(scopedAudit).includes(viewer.user.id),'gestor não descobre outras concessões pessoais pela auditoria');
    const draft=must(await k.call('/api/schedules',{method:'POST',session:draftUser.session,body:{...a.body,publish:false,displayIds:[tv.display.id]}}),201);
    assert.equal((await sequence(k,tv,draftUser.session)).schedules.find(s=>s.id===draft.id).linkStatus,'active','rascunhar não exige publicar');
    await grant(k,tv,[],[allowed.user.id]);
    assert.equal((await sequence(k,tv)).schedules.find(s=>s.id===draft.id).linkStatus,'suspended','revogação também preserva/suspende rascunhos');
  });
});

for(const change of [{active:false},{unitIds:['centro']},{sectorIds:['ti']},{revokes:['schedule:publish']}])test(`alteração de usuário suspende transmissão e arquivo: ${JSON.stringify(change)}`,async()=>{
  await withApp(async k=>{
    const manager=await k.createUser('manager'),tv=await sharedTv(k),a=await material(k,manager);
    const s=await k.liveSchedule(manager.session,{playlistId:a.playlist.id,displayIds:[tv.display.id]});
    must(await k.call(`/api/users/${manager.user.id}`,{method:'PATCH',session:k.admin,body:change}));
    assert.equal((await k.call('/api/me',{session:manager.session})).status,401);
    assert.deepEqual(await manifest(k,tv),[]);
    assert.equal((await k.call(`/api/media/${a.media.id}/file`,{token:tv.token})).status,403);
    assert.equal((await sequence(k,tv)).schedules.find(x=>x.id===s.id).linkStatus,'suspended');
  });
});

test('transferência de unidade preserva identidade/token e suspende inclusive publicação administrativa antiga',async()=>{
  await withApp(async k=>{
    const tv=await sharedTv(k),a=await material(k,{session:k.admin});
    const s=await k.liveSchedule(k.admin,{playlistId:a.playlist.id,displayIds:[tv.display.id]});
    const patch=body=>k.call(`/api/displays/${tv.display.id}`,{method:'PATCH',session:k.admin,body});
    const before=await sequence(k,tv);
    assert.equal((await patch({rev:before.display.accessRev,unitId:'centro'})).status,400);
    const updated=must(await patch({rev:before.display.accessRev,unitId:'centro',sectorIds:['rh'],userIds:[]}));
    assert.equal(updated.id,tv.display.id);assert.equal(updated.paired,true);assert.equal(updated.unitId,'centro');
    assert.deepEqual(await manifest(k,tv),[]);assert.equal((await k.call(`/api/media/${a.media.id}/file`,{token:tv.token})).status,403);
    assert.equal((await sequence(k,tv)).schedules.find(x=>x.id===s.id).linkStatus,'suspended');
    assert.equal((await patch({rev:before.display.accessRev,sectorIds:['rh','ti'],userIds:[]})).status,409);
    const b=await k.approvedMedia(k.admin,{unitId:'centro'}),p=await k.publishedPlaylist(k.admin,[b.id],{unitId:'centro'});
    await k.liveSchedule(k.admin,{unitId:'centro',playlistId:p.id,displayIds:[tv.display.id]});
    assert.deepEqual(await manifest(k,tv),[b.id]);
  });
});

test('permissões legadas/manipuladas não delegam gestão de TVs, concessões, ordem ou usuários',async()=>{
  await withApp(async k=>{
    const tv=await sharedTv(k),target=await k.createUser('viewer');
    for(const role of ['manager','editor','viewer']){
      const person=await k.createUser(role),raw=k.app.services.users.byId(person.user.id);
      raw.grants=['screen:create','screen:update','screen:activate','screen:delete','user:manage'];
      k.app.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(raw),raw.id);
      const session=(await k.login(person.email,PASSWORD)).session;
      const actions=[['POST','/api/displays',{name:'Invasão',unitId:'leste',sectorIds:['rh']}],['PATCH',`/api/displays/${tv.display.id}`,{name:'Invasão'}],['PATCH',`/api/displays/${tv.display.id}`,{rev:1,sectorIds:['ti'],userIds:[]}],['POST',`/api/displays/${tv.display.id}/activate`,{}],['POST',`/api/displays/${tv.display.id}/pairing`,{}],['DELETE',`/api/displays/${tv.display.id}`,undefined],['PUT',`/api/displays/${tv.display.id}/order`,{rev:1,scheduleIds:[]}],['POST','/api/users',{name:'x',email:'x@example.invalid',password:PASSWORD,role:'admin'}],['PATCH',`/api/users/${target.user.id}`,{password:PASSWORD}]];
      for(const [method,url,body]of actions)assert.equal((await k.call(url,{method,session,body})).status,403,`${role} ${method} ${url}`);
    }
  });
});
