import{backend}from"./backend.js";
const $=id=>document.getElementById(id);
const state={route:false,heading:null,members:[],selected:null,ownUserId:null,ownLocation:null,toastTimer:null};

document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>show(button.dataset.go)));
$("createForm").addEventListener("submit",createGroup);
$("joinForm").addEventListener("submit",joinGroup);
$("routeButton").addEventListener("click",toggleRoute);
$("meetButton").addEventListener("click",createMeetingPoint);
$("refreshPending").addEventListener("click",loadPending);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.session?.group_id)loadGroupData();});

initialize();

async function initialize(){
  if(backend.configured){
    try{
      const user=await backend.ensureUser();state.ownUserId=user?.id||null;
      const membership=await backend.myActiveMembership();
      if(membership?.status==="approved")localStorage.setItem("wayvSession",JSON.stringify({...membership,event:membership.name,expiresAt:new Date(membership.expires_at).getTime()}));
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
  $("creatorPanel").classList.toggle("hidden",session.role!=="creator");state.session=session;show("groupView");renderMembers();renderEmptyTarget();
  if(session.role==="creator")loadPending();
  if(backend.configured&&session.group_id){
    await loadGroupData();startRealtime(session.group_id);startLocationSharing(session.group_id);
    clearInterval(state.ageTimer);state.ageTimer=setInterval(()=>{renderMembers();renderSelected();},10000);
  }
}

function startLocationSharing(groupId){
  if(!navigator.geolocation){toast("Este dispositivo no permite obtener ubicación");return;}
  if(state.locationWatch!==undefined)navigator.geolocation.clearWatch(state.locationWatch);
  state.locationWatch=navigator.geolocation.watchPosition(async position=>{
    state.ownLocation={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,heading:position.coords.heading,updatedAt:Date.now()};
    if(Number.isFinite(position.coords.heading)&&state.heading===null)state.heading=position.coords.heading;renderSelected();
    if(document.hidden)return;const now=Date.now();if(now-(state.lastLocationSent||0)<5000)return;state.lastLocationSent=now;
    try{await backend.updateLocation({groupId,latitude:state.ownLocation.latitude,longitude:state.ownLocation.longitude,accuracy:state.ownLocation.accuracy,heading:state.ownLocation.heading});}
    catch(error){toast(friendlyError(error));}
  },error=>toast(error.code===1?"Activa el permiso de ubicación para usar WAYV":"No pudimos obtener tu ubicación"),{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}

async function loadGroupData(){
  if(!state.session?.group_id)return;
  try{
    const[members,locations]=await Promise.all([backend.groupMembers(state.session.group_id),backend.groupLocations(state.session.group_id)]);const byUser=new Map(locations.map(location=>[location.user_id,location]));
    state.members=members.filter(member=>member.user_id!==state.ownUserId).map(member=>{const location=byUser.get(member.user_id);return{...member,name:member.nickname,initials:initials(member.nickname),location:location?{latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,heading:location.heading,updatedAt:new Date(location.updated_at).getTime()}:null};});
    if(!state.members.some(member=>member.user_id===state.selected))state.selected=state.members[0]?.user_id||null;renderMembers();renderSelected();
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
  state.unsubscribe=await backend.subscribeToGroup(groupId,()=>{clearTimeout(state.reloadTimer);state.reloadTimer=setTimeout(()=>{loadGroupData();if(state.session?.role==="creator")loadPending();},250);});
}

function renderMembers(){
  $("memberChips").innerHTML=state.members.map(member=>{const status=isLive(member.location)?"Live":member.location?ageLabel(member.location.updatedAt):"Sin ubicación";return`<button class="chip ${member.user_id===state.selected?"selected":""} ${isLive(member.location)?"":"offline"}" data-member="${member.user_id}">${escapeHtml(member.name)} · ${status}</button>`;}).join("");
  document.querySelectorAll("[data-member]").forEach(button=>button.onclick=()=>selectMember(button.dataset.member));
}

function selectMember(userId){state.selected=userId;state.route=false;renderMembers();renderSelected();}

function renderSelected(){
  const member=current();if(!member){renderEmptyTarget();return;}
  $("targetInitials").textContent=member.initials;$("targetName").textContent=member.name;const ready=Boolean(member.location&&state.ownLocation);
  if(ready){member.distance=Math.round(distanceMeters(state.ownLocation,member.location));member.bearing=bearingDegrees(state.ownLocation,member.location);$("distanceValue").textContent=formatDistance(member.distance);$("accuracyValue").textContent=`Precisión ±${Math.round(member.location.accuracy)} m`;}
  else{$("distanceValue").textContent="—";$("accuracyValue").textContent=member.location?"Esperando tu ubicación":"Aún no comparte ubicación";}
  $("routeButton").disabled=!ready;$("routeButton").textContent=state.route?"Detener indicaciones":ready?`Trazar ruta hacia ${member.name}`:"Ubicación todavía no disponible";$("routeButton").classList.toggle("active",state.route);$("guideArrow").classList.toggle("active",state.route);$("guidance").classList.toggle("hidden",!state.route);renderStatus(member);updateGuide();
}

function renderEmptyTarget(){
  $("targetInitials").textContent="··";$("targetName").textContent="Esperando amigos";$("distanceValue").textContent="—";$("accuracyValue").textContent="Sin ubicación disponible";$("routeButton").disabled=true;$("routeButton").textContent="Selecciona a un integrante";$("guideArrow").classList.remove("active");$("guidance").classList.add("hidden");$("liveLabel").textContent="Sin integrantes";document.querySelector(".live-dot").classList.add("offline");$("updatedLabel").textContent="Comparte el enlace privado para comenzar";
}

async function toggleRoute(){if(!current()?.location||!state.ownLocation)return;if(!state.orientationStarted)await startOrientation();state.route=!state.route;renderSelected();}

async function startOrientation(){
  try{
    if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function"){const permission=await DeviceOrientationEvent.requestPermission();if(permission!=="granted")throw new Error("Permiso de brújula rechazado");}
    const handler=event=>{const heading=Number.isFinite(event.webkitCompassHeading)?event.webkitCompassHeading:Number.isFinite(event.alpha)?normalize(360-event.alpha):null;if(heading!==null){state.heading=heading;updateGuide();}};
    window.addEventListener("deviceorientationabsolute",handler,true);window.addEventListener("deviceorientation",handler,true);state.orientationStarted=true;
  }catch(error){toast(error.message||"No pudimos activar la brújula");}
}

function updateGuide(){
  const member=current();if(!member||!Number.isFinite(member.bearing))return;const heading=Number.isFinite(state.heading)?state.heading:state.ownLocation?.heading;
  if(!Number.isFinite(heading)){if(state.route)$("guidanceText").textContent="Mueve el teléfono para calibrar la brújula";return;}
  const turn=difference(member.bearing,heading);$("guideArrow").style.transform=`rotate(${turn}deg)`;if(!state.route)return;const abs=Math.abs(turn);let text="Sigue recto",icon="↑";
  if(abs>135){text="Vas en dirección equivocada · da la vuelta";icon="↶";if("vibrate"in navigator)navigator.vibrate([80,60,80]);}else if(abs>45){text=turn<0?"Camina hacia la izquierda":"Camina hacia la derecha";icon=turn<0?"←":"→";}else if(abs>15){text=turn<0?"Ve ligeramente a la izquierda":"Ve ligeramente a la derecha";icon=turn<0?"↖":"↗";}
  $("guidanceText").textContent=text;$("guidanceIcon").textContent=icon;$("guidanceDetail").textContent=abs<=15?"Mantén esta dirección":`Gira aproximadamente ${Math.round(abs)}°`;
}

async function createMeetingPoint(){if(!state.ownLocation){toast("Esperando una ubicación precisa para crear el punto");return;}try{await backend.createMeetingPoint({groupId:state.session.group_id,latitude:state.ownLocation.latitude,longitude:state.ownLocation.longitude});toast("Punto de encuentro compartido con el grupo");}catch(error){toast(friendlyError(error));}}

function renderStatus(member){const live=isLive(member.location);$("liveLabel").textContent=live?"Live":"Offline";document.querySelector(".live-dot").classList.toggle("offline",!live);$("updatedLabel").textContent=member.location?live?"Actualizada ahora":`Última ubicación · ${ageLabel(member.location.updatedAt)}`:"Todavía no comparte ubicación";}
function current(){return state.members.find(member=>member.user_id===state.selected);}
function isLive(location){return Boolean(location&&Date.now()-location.updatedAt<30000);}
function ageLabel(timestamp){const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));if(seconds<60)return`hace ${seconds} s`;const minutes=Math.floor(seconds/60);if(minutes<60)return`hace ${minutes} min`;return`hace ${Math.floor(minutes/60)} h`;}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase();}
function formatDistance(meters){return meters<1000?`${meters} m`:`${(meters/1000).toFixed(1)} km`;}
function distanceMeters(a,b){const radius=6371000,p1=a.latitude*Math.PI/180,p2=b.latitude*Math.PI/180,dp=(b.latitude-a.latitude)*Math.PI/180,dl=(b.longitude-a.longitude)*Math.PI/180,value=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return radius*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));}
function bearingDegrees(a,b){const p1=a.latitude*Math.PI/180,p2=b.latitude*Math.PI/180,dl=(b.longitude-a.longitude)*Math.PI/180;return normalize(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI);}
function expiry(){const value=Number($("durationValue").value);return Date.now()+value*($("durationUnit").value==="days"?86400000:3600000);}
function normalize(angle){return((angle%360)+360)%360;}
function difference(target,origin){return((target-origin+540)%360)-180;}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3000);}
function friendlyError(error){return error?.message?.replace("Invitation not found or expired","Invitación inexistente o vencida").replace("Supabase no está configurado","WAYV no está conectado a su base de datos")||"Ocurrió un error inesperado";}
function escapeHtml(value){const div=document.createElement("div");div.textContent=value;return div.innerHTML;}

if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js"));
