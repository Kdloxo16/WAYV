import{backend}from"./backend.js";
const $=id=>document.getElementById(id);
const NEAR_METERS=20,MAX_SHARED_ACCURACY=75,COLORS=["#BDFF78","#3892FF","#FF6BCE","#FFB347"];
const state={route:false,heading:null,members:[],selected:null,ownUserId:null,ownLocation:null,locationSamples:[],rejectedLocations:0,toastTimer:null};

document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>show(button.dataset.go)));
$("createForm").addEventListener("submit",createGroup);
$("joinForm").addEventListener("submit",joinGroup);
$("routeButton").addEventListener("click",toggleRoute);
$("meetButton").addEventListener("click",createMeetingPoint);
$("refreshPending").addEventListener("click",loadPending);
$("shareInvite").addEventListener("click",shareInvitation);
$("copyInvite").addEventListener("click",copyInvitation);
$("menuButton").addEventListener("click",()=>$("groupActions").classList.toggle("hidden"));
$("leaveGroupButton").addEventListener("click",leaveCurrentGroup);
$("findButton").addEventListener("click",sendVisibilitySignal);
$("recalibrateGps").addEventListener("click",recalibrateGps);
$("dismissMeeting").addEventListener("click",()=>$("meetingAlert").classList.add("hidden"));
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.session?.group_id)loadGroupData();});

initialize();

async function initialize(){
  if(backend.configured){
    try{
      const user=await backend.ensureUser();state.ownUserId=user?.id||null;
      const membership=await backend.myActiveMembership();
      if(membership?.status==="approved"){
        const session={...membership,event:membership.name,expiresAt:new Date(membership.expires_at).getTime()};localStorage.setItem("wayvSession",JSON.stringify(session));
        enterGroup(session);return;
      }
      else if(membership?.status==="pending"){show("waitingView");watchApproval();return;}
    }catch(error){toast(`No se pudo conectar: ${friendlyError(error)}`);}
  }
  restoreSession();
}

function show(id){document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===id));}

async function createGroup(event){
  event.preventDefault();
  const input={name:$("eventName").value.trim(),nickname:$("creatorName").value.trim(),expiresAt:expiry()};
  try{
    const session=await backend.createGroup(input);if(!session)throw new Error("Supabase no está configurado");
    const saved={...session,event:session.name,expiresAt:new Date(session.expires_at).getTime()};
    localStorage.setItem("wayvSession",JSON.stringify(saved));enterGroup(saved);toast(`Grupo privado creado · código ${saved.invite_code}`);
  }catch(error){toast(friendlyError(error));}
}

async function joinGroup(event){
  event.preventDefault();
  const request={nickname:$("memberName").value.trim(),code:$("inviteCode").value.trim().toUpperCase()};
  try{await backend.requestJoin(request);localStorage.setItem("wayvPending",JSON.stringify(request));show("waitingView");watchApproval();}
  catch(error){toast(friendlyError(error));}
}

function watchApproval(){
  clearInterval(state.approvalTimer);
  state.approvalTimer=setInterval(async()=>{
    try{
      const membership=await backend.myActiveMembership();if(membership?.status!=="approved")return;
      clearInterval(state.approvalTimer);
      const session={...membership,event:membership.name,expiresAt:new Date(membership.expires_at).getTime()};
      localStorage.setItem("wayvSession",JSON.stringify(session));localStorage.removeItem("wayvPending");enterGroup(session);toast("¡Tu acceso fue aprobado!");
    }catch{}
  },5000);
}

function restoreSession(){
  const session=JSON.parse(localStorage.getItem("wayvSession")||"null");
  if(session&&session.expiresAt>Date.now()){
    $("resumeHint").textContent=`Sesión activa en ${session.event}`;$("resumeHint").classList.remove("hidden");$("resumeHint").onclick=()=>enterGroup(session);
  }
  const params=new URLSearchParams(location.search);if(params.get("invite")){show("joinView");$("inviteCode").value=params.get("invite").toUpperCase();}
}

async function enterGroup(session){
  $("eventEyebrow").textContent=session.event.toUpperCase();$("groupTitle").textContent="Mi grupo";$("menuButton").textContent=(session.nickname||"YO").slice(0,2).toUpperCase();
  $("creatorPanel").classList.toggle("hidden",session.role!=="creator");$("groupActions").classList.add("hidden");$("sessionIdentity").textContent=`${session.nickname} · ${session.role==="creator"?"Creador":"Integrante"}`;$("leaveGroupButton").textContent=session.role==="creator"?"Eliminar grupo":"Salir del grupo";state.session=session;setupInvitation(session);show("groupView");renderMembers();renderEmptyTarget();
  if(session.role==="creator")loadPending();
  if(backend.configured&&session.group_id){
    await Promise.all([loadGroupData(),loadMeetingPoint(),loadVisibilitySignal()]);startRealtime(session.group_id);startLocationSharing(session.group_id);
    clearInterval(state.ageTimer);state.ageTimer=setInterval(()=>{renderMembers();renderSelected();},10000);
  }
}

function startLocationSharing(groupId){
  if(!navigator.geolocation){toast("Este dispositivo no permite obtener ubicación");return;}
  if(state.locationWatch!==undefined)navigator.geolocation.clearWatch(state.locationWatch);
  state.locationWatch=navigator.geolocation.watchPosition(async position=>{
    const next={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,heading:position.coords.heading,updatedAt:Date.now()};
    const stabilized=stabilizeLocation(next);
    if(!stabilized){$("signalHint").textContent=state.rejectedLocations?"Descartando un salto impreciso del GPS":"Buscando una señal GPS válida";return;}
    state.ownLocation=stabilized;$("signalHint").textContent=state.locationSamples.length<4?`Estabilizando GPS · ${state.locationSamples.length}/4 muestras`:gpsQuality(state.ownLocation.accuracy);if(state.locationSamples.length<4)return;
    if(Number.isFinite(position.coords.heading)&&state.heading===null)state.heading=position.coords.heading;renderSelected();
    if(state.ownLocation.accuracy>MAX_SHARED_ACCURACY){$("signalHint").textContent=`GPS deficiente · ±${Math.round(state.ownLocation.accuracy)} m · recalibra`;return;}
    if(document.hidden)return;const now=Date.now();if(now-(state.lastLocationSent||0)<5000)return;state.lastLocationSent=now;
    try{await backend.updateLocation({groupId,latitude:state.ownLocation.latitude,longitude:state.ownLocation.longitude,accuracy:state.ownLocation.accuracy,heading:state.ownLocation.heading});}
    catch(error){toast(friendlyError(error));}
  },error=>toast(error.code===1?"Activa el permiso de ubicación para usar WAYV":"No pudimos obtener tu ubicación"),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}

function recalibrateGps(){state.locationSamples=[];state.rejectedLocations=0;state.ownLocation=null;state.lastLocationSent=0;$("signalHint").textContent="Recalibrando GPS · mantén WAYV abierta";renderSelected();if(state.session?.group_id)startLocationSharing(state.session.group_id);toast("Recalibrando ubicación");}

async function loadGroupData(){
  if(!state.session?.group_id)return;
  try{
    const[members,locations]=await Promise.all([backend.groupMembers(state.session.group_id),backend.groupLocations(state.session.group_id)]);const byUser=new Map(locations.map(location=>[location.user_id,location]));
    state.members=members.filter(member=>member.user_id!==state.ownUserId).map(member=>{const location=byUser.get(member.user_id);return{...member,name:member.nickname,initials:initials(member.nickname),location:location?{latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,heading:location.heading,updatedAt:new Date(location.updated_at).getTime()}:null};});
    if(!state.members.some(member=>member.user_id===state.selected))state.selected=state.members[0]?.user_id||null;renderMembers();renderSelected();renderMap();
  }catch(error){toast(friendlyError(error));}
}

async function loadPending(){
  if(!backend.configured||!state.session?.group_id)return;
  try{
    const pending=await backend.pendingMembers(state.session.group_id);
    $("pendingList").innerHTML=pending.length?pending.map(item=>`<div class="pending-item"><span><b>${escapeHtml(item.nickname)}</b><small>Solicita entrar</small></span><div class="pending-actions"><button class="approve" data-approve="${item.id}">Aprobar</button><button class="reject" data-reject="${item.id}">Rechazar</button></div></div>`).join(""):"<small>No hay solicitudes pendientes</small>";
    document.querySelectorAll("[data-approve]").forEach(button=>button.onclick=()=>reviewMember(button.dataset.approve,true));document.querySelectorAll("[data-reject]").forEach(button=>button.onclick=()=>reviewMember(button.dataset.reject,false));
  }catch(error){toast(friendlyError(error));}
}

async function reviewMember(id,approve){try{approve?await backend.approveMember(id):await backend.rejectMember(id);toast(approve?"Integrante aprobado":"Solicitud rechazada");await loadPending();await loadGroupData();}catch(error){toast(friendlyError(error));}}

async function startRealtime(groupId){
  if(state.unsubscribe)state.unsubscribe();
  state.unsubscribe=await backend.subscribeToGroup(groupId,()=>{clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(()=>{loadGroupData();loadMeetingPoint(true);loadVisibilitySignal();if(state.session?.role==="creator")loadPending();},250);});
}

function renderMembers(){
  $("memberChips").innerHTML=state.members.map(member=>{const status=isLive(member.location)?"Live":member.location?ageLabel(member.location.updatedAt):"Sin ubicación";return`<button class="chip ${member.user_id===state.selected?"selected":""} ${isLive(member.location)?"":"offline"}" data-member="${member.user_id}">${escapeHtml(member.name)} · ${status}</button>`;}).join("");
  document.querySelectorAll("[data-member]").forEach(button=>button.onclick=()=>selectMember(button.dataset.member));
}

function selectMember(userId){state.selected=userId;state.route=false;renderMembers();renderSelected();renderMap();}

function renderSelected(){
  const member=current();if(!member){renderEmptyTarget();return;}
  $("targetInitials").textContent=member.initials;$("targetName").textContent=member.name;const hasLocations=Boolean(member.location&&state.ownLocation);const combined=hasLocations?combinedAccuracy(state.ownLocation,member.location):Infinity;
  if(hasLocations){member.distance=distanceMeters(state.ownLocation,member.location);member.bearing=bearingDegrees(state.ownLocation,member.location);$("distanceValue").textContent=distanceLabel(member.distance,combined);$("accuracyValue").textContent=combined>50?`Señal GPS baja · ±${Math.round(combined)} m`:`Precisión combinada ±${Math.round(combined)} m`;}
  else{$("distanceValue").textContent="—";$("accuracyValue").textContent=member.location?"Esperando tu ubicación":"Aún no comparte ubicación";}
  const veryNear=hasLocations&&member.distance<=Math.max(NEAR_METERS,combined*1.15),directionReliable=hasLocations&&member.distance>Math.max(NEAR_METERS,combined*1.5),ready=hasLocations&&combined<=50&&directionReliable&&!veryNear;if(!ready)state.route=false;
  $("routeButton").disabled=!ready;$("routeButton").textContent=state.route?"Detener indicaciones":veryNear?"Ya está muy cerca":ready?`Trazar ruta hacia ${member.name}`:hasLocations&&combined>50?"Esperando mejor señal GPS":hasLocations?"Dirección inestable · está muy cerca":"Ubicación todavía no disponible";$("findButton").classList.toggle("hidden",!veryNear);$("findButton").textContent=`Pedir a ${member.name} que se haga visible`;$("routeButton").classList.toggle("active",state.route);$("guideArrow").classList.toggle("active",state.route);$("guidance").classList.toggle("hidden",!state.route);renderStatus(member);updateGuide();renderMap();
}

function renderEmptyTarget(){
  $("targetInitials").textContent="··";$("targetName").textContent="Esperando amigos";$("distanceValue").textContent="—";$("accuracyValue").textContent="Sin ubicación disponible";$("routeButton").disabled=true;$("routeButton").textContent="Selecciona a un integrante";$("findButton").classList.add("hidden");$("guideArrow").classList.remove("active");$("guidance").classList.add("hidden");$("liveLabel").textContent="Sin integrantes";document.querySelector(".live-dot").classList.add("offline");$("updatedLabel").textContent="Comparte el enlace privado para comenzar";renderMap();
}

function renderMap(){
  if(!$("mapMarkers"))return;const located=state.members.filter(member=>member.location&&state.ownLocation);
  const measurements=located.map(member=>({member,distance:distanceMeters(state.ownLocation,member.location),bearing:bearingDegrees(state.ownLocation,member.location)}));
  const scale=Math.max(20,Math.min(1000,Math.max(0,...measurements.map(item=>item.distance))*1.15));
  $("mapMarkers").innerHTML=measurements.map(({member,distance,bearing},index)=>{const near=distance<=Math.max(NEAR_METERS,combinedAccuracy(state.ownLocation,member.location)*1.15),shownBearing=near?stableAngle(member.user_id):bearing,radius=near?15+(index%3)*6:Math.min(42,distance/scale*42),angle=shownBearing*Math.PI/180,left=50+Math.sin(angle)*radius,top=50-Math.cos(angle)*radius;return`<button class="map-person ${member.user_id===state.selected?"selected":""} ${isLive(member.location)?"":"offline"}" data-map-member="${member.user_id}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"><b>${member.initials}</b><span>${escapeHtml(member.name)}</span></button>`;}).join("");
  if(state.meetingPoint&&state.ownLocation){const distance=distanceMeters(state.ownLocation,state.meetingPoint),bearing=bearingDegrees(state.ownLocation,state.meetingPoint),radius=Math.min(42,distance/scale*42),angle=bearing*Math.PI/180,left=50+Math.sin(angle)*radius,top=50-Math.cos(angle)*radius;$("mapMarkers").insertAdjacentHTML("beforeend",`<div class="meeting-marker" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"><b>⌖</b><span>REUNIÓN</span></div>`);}
  document.querySelectorAll("[data-map-member]").forEach(button=>button.onclick=()=>selectMember(button.dataset.mapMember));
}

async function toggleRoute(){if(!current()?.location||!state.ownLocation)return;if(!state.orientationStarted)await startOrientation();state.route=!state.route;renderSelected();}

async function startOrientation(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){const permission=await DeviceOrientationEvent.requestPermission();if(permission!=="granted")throw new Error("Permiso de brújula rechazado");}
    const handler=event=>{const heading=Number.isFinite(event.webkitCompassHeading)?event.webkitCompassHeading:Number.isFinite(event.alpha)?normalize(360-event.alpha):null;if(heading!==null){state.heading=smoothAngle(state.heading,heading,.12);updateGuide();}};
    window.addEventListener("deviceorientation",handler,true);state.orientationStarted=true;
  }catch(error){toast(error.message||"No pudimos activar la brújula");}
}

function updateGuide(){
  const member=current();if(!member||!Number.isFinite(member.bearing))return;const heading=Number.isFinite(state.heading)?state.heading:state.ownLocation?.heading;
  if(!Number.isFinite(heading)){if(state.route)$("guidanceText").textContent="Mueve el teléfono para calibrar la brújula";return;}
  const turn=difference(member.bearing,heading);$("guideArrow").style.transform=`rotate(${turn}deg)`;if(!state.route)return;const abs=Math.abs(turn);let text="Sigue recto";
  if(abs>135){text="Vas en dirección equivocada · da la vuelta";if("vibrate"in navigator)navigator.vibrate([80,60,80]);}else if(abs>45){text=turn<0?"Camina hacia la izquierda":"Camina hacia la derecha";}else if(abs>15){text=turn<0?"Ve ligeramente a la izquierda":"Ve ligeramente a la derecha";}
  $("guidanceText").textContent=text;$("guidanceDetail").textContent=abs<=15?"Mantén esta dirección":`Gira aproximadamente ${Math.round(abs)}°`;
}

async function createMeetingPoint(){if(!state.ownLocation){toast("Esperando una ubicación precisa para crear el punto");return;}try{state.meetingPoint=await backend.createMeetingPoint({groupId:state.session.group_id,latitude:state.ownLocation.latitude,longitude:state.ownLocation.longitude});showMeetingPoint(false);renderMap();toast("Punto de encuentro compartido con el grupo");}catch(error){toast(friendlyError(error));}}
async function loadMeetingPoint(notify=false){if(!state.session?.group_id)return;try{const point=await backend.latestMeetingPoint(state.session.group_id);if(!point||Date.now()-new Date(point.created_at).getTime()>7200000)return;const isNew=point.id!==state.meetingPoint?.id;state.meetingPoint=point;showMeetingPoint(notify&&isNew);renderMap();}catch{}}
function showMeetingPoint(notify){const point=state.meetingPoint;if(!point)return;const creator=point.creator_id===state.ownUserId?"Tú":state.members.find(member=>member.user_id===point.creator_id)?.name||"Un integrante";$("meetingMessage").textContent=`${creator} marcó un punto · ${ageLabel(new Date(point.created_at).getTime())}`;$("meetingAlert").classList.remove("hidden");if(notify&&point.creator_id!==state.ownUserId){toast("Nuevo punto de encuentro");if("vibrate"in navigator)navigator.vibrate([120,80,120]);}}

async function sendVisibilitySignal(){const member=current();if(!member)return;const color=COLORS[Math.abs(hashCode(state.ownUserId+member.user_id))%COLORS.length];try{await backend.sendVisibilitySignal({groupId:state.session.group_id,targetUserId:member.user_id,color});toast(`${member.name} recibió tu solicitud`);}catch(error){toast(friendlyError(error));}}
async function loadVisibilitySignal(){if(!state.session?.group_id)return;try{const signal=await backend.latestVisibilitySignal(state.session.group_id);if(!signal||signal.id===state.lastSignalId)return;state.lastSignalId=signal.id;const sender=state.members.find(member=>member.user_id===signal.sender_id)?.name||"Un amigo";showVisibilityMode(sender,signal.color);}catch{}}
function showVisibilityMode(sender,color){const overlay=document.createElement("section");overlay.className="visibility-mode";overlay.style.setProperty("--signal-color",color);overlay.innerHTML=`<div><small>${escapeHtml(sender)} TE ESTÁ BUSCANDO</small><strong>¡HAZTE VISIBLE!</strong><span>Levanta el teléfono para que pueda encontrarte.</span><button type="button">Ya me vio</button></div>`;overlay.querySelector("button").onclick=()=>overlay.remove();document.body.append(overlay);if("vibrate"in navigator)navigator.vibrate([150,80,150,80,300]);setTimeout(()=>overlay.remove(),120000);}

async function leaveCurrentGroup(){
  const session=state.session;if(!session)return;const deleting=session.role==="creator";const confirmed=confirm(deleting?"¿Eliminar este grupo para todos? Esta acción no se puede deshacer.":"¿Salir de este grupo?");if(!confirmed)return;
  try{deleting?await backend.deleteGroup(session.group_id):await backend.leaveGroup(session.group_id);cleanupGroup();toast(deleting?"Grupo eliminado":"Saliste del grupo");show("homeView");}
  catch(error){toast(friendlyError(error));}
}
function cleanupGroup(){localStorage.removeItem("wayvSession");localStorage.removeItem("wayvPending");state.session=null;state.members=[];state.selected=null;state.ownLocation=null;state.locationSamples=[];state.meetingPoint=null;if(state.locationWatch!==undefined){navigator.geolocation.clearWatch(state.locationWatch);state.locationWatch=undefined;}if(state.unsubscribe){state.unsubscribe();state.unsubscribe=null;}clearInterval(state.ageTimer);$("resumeHint").classList.add("hidden");$("groupActions").classList.add("hidden");$("meetingAlert").classList.add("hidden");}

function setupInvitation(session){
  const canInvite=session.role==="creator"&&Boolean(session.invite_code);$("invitePanel").classList.toggle("hidden",!canInvite);
  if(!canInvite)return;$("groupInviteCode").textContent=session.invite_code;state.inviteUrl=invitationUrl(session.invite_code);
}
function invitationUrl(code){const url=new URL(location.href);url.search="";url.hash="";url.searchParams.set("invite",code);return url.toString();}
async function shareInvitation(){
  const session=state.session;if(!state.inviteUrl)return;
  const data={title:`WAYV · ${session.event}`,text:`Únete a mi grupo ${session.event} en WAYV. El creador deberá aprobar tu entrada.`,url:state.inviteUrl};
  try{if(navigator.share){await navigator.share(data);return;}await copyText(state.inviteUrl);toast("Enlace privado copiado");}catch(error){if(error?.name!=="AbortError")toast("No se pudo compartir la invitación");}
}
async function copyInvitation(){if(!state.inviteUrl)return;try{await copyText(state.inviteUrl);toast("Enlace privado copiado");}catch{toast("No se pudo copiar el enlace");}}
async function copyText(value){if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);const area=document.createElement("textarea");area.value=value;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();const copied=document.execCommand("copy");area.remove();if(!copied)throw new Error("Copy failed");}

function renderStatus(member){const live=isLive(member.location);$("liveLabel").textContent=live?"Live":"Offline";document.querySelector(".live-dot").classList.toggle("offline",!live);$("updatedLabel").textContent=member.location?live?"Actualizada ahora":`Última ubicación · ${ageLabel(member.location.updatedAt)}`:"Todavía no comparte ubicación";}
function current(){return state.members.find(member=>member.user_id===state.selected);}
function isLive(location){return Boolean(location&&Date.now()-location.updatedAt<30000);}
function ageLabel(timestamp){const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));if(seconds<60)return`hace ${seconds} s`;const minutes=Math.floor(seconds/60);if(minutes<60)return`hace ${minutes} min`;return`hace ${Math.floor(minutes/60)} h`;}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase();}
function combinedAccuracy(a,b){return Math.hypot(Number(a.accuracy)||0,Number(b.accuracy)||0);}
function distanceLabel(distance,accuracy){if(distance<=NEAR_METERS||distance<=accuracy)return"Muy cerca";const rounded=Math.round(distance);return rounded<1000?`≈ ${rounded} m`:`≈ ${(rounded/1000).toFixed(1)} km`;}
function stabilizeLocation(next){
  if(!Number.isFinite(next.latitude)||!Number.isFinite(next.longitude)||!Number.isFinite(next.accuracy)||next.accuracy<=0||next.accuracy>150)return null;
  const previous=state.ownLocation;
  if(previous){const elapsed=Math.max(.5,(next.updatedAt-previous.updatedAt)/1000),jump=distanceMeters(previous,next),uncertainty=Math.hypot(previous.accuracy,next.accuracy),maximumJump=Math.max(20,uncertainty*1.35+elapsed*4.5);if(jump>maximumJump&&next.accuracy>=previous.accuracy*.7){state.rejectedLocations+=1;return null;}}
  state.rejectedLocations=0;state.locationSamples.push(next);const windowMs=state.route?6000:12000,now=next.updatedAt;state.locationSamples=state.locationSamples.filter(sample=>now-sample.updatedAt<=windowMs).slice(-8);
  let total=0,latitude=0,longitude=0;for(const sample of state.locationSamples){const recency=Math.exp(-(now-sample.updatedAt)/4000),weight=recency/Math.max(9,sample.accuracy**2);total+=weight;latitude+=sample.latitude*weight;longitude+=sample.longitude*weight;}
  const accuracy=median(state.locationSamples.map(sample=>sample.accuracy));return{latitude:latitude/total,longitude:longitude/total,accuracy,heading:next.heading,updatedAt:next.updatedAt};
}
function median(values){const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;}
function gpsQuality(accuracy){return accuracy<=8?`GPS excelente · ±${Math.round(accuracy)} m`:accuracy<=20?`GPS aceptable · ±${Math.round(accuracy)} m`:accuracy<=MAX_SHARED_ACCURACY?`GPS limitado · ±${Math.round(accuracy)} m`:`GPS deficiente · ±${Math.round(accuracy)} m`;}
function hashCode(value){let hash=0;for(const character of String(value))hash=(hash*31+character.charCodeAt(0))|0;return hash;}
function stableAngle(value){return Math.abs(hashCode(value))%360;}
function smoothAngle(previous,next,alpha){if(!Number.isFinite(previous))return next;return normalize(previous+difference(next,previous)*alpha);}
function distanceMeters(a,b){const radius=6371000,p1=a.latitude*Math.PI/180,p2=b.latitude*Math.PI/180,dp=(b.latitude-a.latitude)*Math.PI/180,dl=(b.longitude-a.longitude)*Math.PI/180,value=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return radius*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));}
function bearingDegrees(a,b){const p1=a.latitude*Math.PI/180,p2=b.latitude*Math.PI/180,dl=(b.longitude-a.longitude)*Math.PI/180;return normalize(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI);}
function expiry(){const value=Number($("durationValue").value);return Date.now()+value*($("durationUnit").value==="days"?86400000:3600000);}
function normalize(angle){return((angle%360)+360)%360;}
function difference(target,origin){return((target-origin+540)%360)-180;}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3000);}
function friendlyError(error){return error?.message?.replace("Invitation not found or expired","Invitación inexistente o vencida").replace("Supabase no está configurado","WAYV no está conectado a su base de datos")||"Ocurrió un error inesperado";}
function escapeHtml(value){const div=document.createElement("div");div.textContent=value;return div.innerHTML;}

if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js"));
