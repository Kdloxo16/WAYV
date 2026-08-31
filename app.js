import{backend}from"./services/backend.js";
const $=id=>document.getElementById(id);
const state={route:false,heading:0,bearing:42,selected:"kiki",live:true,toastTimer:null};
const members=[{id:"kiki",name:"KIKI",initials:"KI",distance:74,bearing:42,accuracy:8,live:true},{id:"amelie",name:"Amelie",initials:"AM",distance:126,bearing:298,accuracy:15,live:false},{id:"marlon",name:"Marlon",initials:"MA",distance:48,bearing:165,accuracy:11,live:true}];

document.querySelectorAll("[data-go]").forEach(button=>button.addEventListener("click",()=>show(button.dataset.go)));
$("createForm").addEventListener("submit",createGroup);
$("joinForm").addEventListener("submit",joinGroup);
$("demoApprove").addEventListener("click",approveDemo);
$("routeButton").addEventListener("click",toggleRoute);
$("meetButton").addEventListener("click",()=>toast("Punto de encuentro preparado para el grupo"));
$("toggleLive").addEventListener("click",toggleLive);
$("refreshPending").addEventListener("click",loadPending);
document.querySelectorAll("[data-turn]").forEach(button=>button.addEventListener("click",()=>turn(Number(button.dataset.turn))));

initialize();

async function initialize(){
  if(backend.configured){
    try{
      await backend.ensureUser();
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
  let session={role:"creator",nickname:input.nickname,event:input.name,expiresAt:input.expiresAt,invite_code:"WV-K8J4"};
  try{const remote=await backend.createGroup(input);if(remote)session={...remote,event:remote.name,expiresAt:new Date(remote.expires_at).getTime()};}
  catch(error){toast(friendlyError(error));return;}
  localStorage.setItem("wayvSession",JSON.stringify(session));
  enterGroup(session);
  toast(`Grupo privado creado · código ${session.invite_code}`);
}

async function joinGroup(event){
  event.preventDefault();
  const request={nickname:$("memberName").value.trim(),code:$("inviteCode").value.trim().toUpperCase()};
  try{await backend.requestJoin(request);}catch(error){toast(friendlyError(error));return;}
  localStorage.setItem("wayvPending",JSON.stringify(request));
  show("waitingView");
  if(backend.configured)watchApproval();
}

function watchApproval(){
  clearInterval(state.approvalTimer);
  state.approvalTimer=setInterval(async()=>{
    try{
      const membership=await backend.myActiveMembership();
      if(membership?.status!=="approved")return;
      clearInterval(state.approvalTimer);
      const session={...membership,event:membership.name,expiresAt:new Date(membership.expires_at).getTime()};
      localStorage.setItem("wayvSession",JSON.stringify(session));
      enterGroup(session);toast("¡Tu acceso fue aprobado!");
    }catch{}
  },5000);
}

function approveDemo(){
  const pending=JSON.parse(localStorage.getItem("wayvPending")||"{}");
  const session={role:"member",nickname:pending.nickname||"Invitado",event:"Awakenings 2027",expiresAt:Date.now()+172800000};
  localStorage.setItem("wayvSession",JSON.stringify(session));
  localStorage.removeItem("wayvPending");
  enterGroup(session);
}

function restoreSession(){
  const session=JSON.parse(localStorage.getItem("wayvSession")||"null");
  if(session&&session.expiresAt>Date.now()){
    $("resumeHint").textContent=`Sesión activa en ${session.event}`;
    $("resumeHint").classList.remove("hidden");
    $("resumeHint").onclick=()=>enterGroup(session);
  }
  const params=new URLSearchParams(location.search);
  if(params.get("invite")){show("joinView");$("inviteCode").value=params.get("invite").toUpperCase();}
}

function enterGroup(session){
  $("eventEyebrow").textContent=session.event.toUpperCase();
  $("groupTitle").textContent="Mi grupo";
  $("menuButton").textContent=(session.nickname||"YO").slice(0,2).toUpperCase();
  $("creatorPanel").classList.toggle("hidden",session.role!=="creator");
  state.session=session;
  renderMembers();selectMember(state.selected);show("groupView");
  if(session.role==="creator")loadPending();
  if(backend.configured&&session.group_id){startRealtime(session.group_id);startLocationSharing(session.group_id);}
}

function startLocationSharing(groupId){
  if(!navigator.geolocation)return;
  if(state.locationWatch!==undefined)navigator.geolocation.clearWatch(state.locationWatch);
  state.locationWatch=navigator.geolocation.watchPosition(async position=>{
    if(document.hidden)return;
    const now=Date.now();if(now-(state.lastLocationSent||0)<5000)return;state.lastLocationSent=now;
    try{await backend.updateLocation({groupId,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,heading:position.coords.heading});}
    catch(error){toast(friendlyError(error));}
  },()=>toast("WAYV necesita tu ubicación para compartirla"),{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}

async function loadPending(){
  if(!backend.configured||!state.session?.group_id){$("pendingList").innerHTML="<small>Conecta Supabase para recibir solicitudes reales</small>";return;}
  try{
    const pending=await backend.pendingMembers(state.session.group_id);
    $("pendingList").innerHTML=pending.length?pending.map(item=>`<div class="pending-item"><span><b>${escapeHtml(item.nickname)}</b><small>Solicita entrar</small></span><div class="pending-actions"><button class="approve" data-approve="${item.id}">Aprobar</button><button class="reject" data-reject="${item.id}">Rechazar</button></div></div>`).join(""):"<small>No hay solicitudes pendientes</small>";
    document.querySelectorAll("[data-approve]").forEach(button=>button.onclick=()=>reviewMember(button.dataset.approve,true));
    document.querySelectorAll("[data-reject]").forEach(button=>button.onclick=()=>reviewMember(button.dataset.reject,false));
  }catch(error){toast(friendlyError(error));}
}

async function reviewMember(id,approve){
  try{approve?await backend.approveMember(id):await backend.rejectMember(id);toast(approve?"Integrante aprobado":"Solicitud rechazada");loadPending();}catch(error){toast(friendlyError(error));}
}

async function startRealtime(groupId){
  if(state.unsubscribe)state.unsubscribe();
  state.unsubscribe=await backend.subscribeToGroup(groupId,()=>{if(state.session?.role==="creator")loadPending();});
}

function renderMembers(){
  $("memberChips").innerHTML=members.map(member=>`<button class="chip ${member.id===state.selected?"selected":""} ${member.live?"":"offline"}" data-member="${member.id}">${member.name} · ${member.live?"Live":"Offline"}</button>`).join("");
  document.querySelectorAll("[data-member]").forEach(button=>button.addEventListener("click",()=>selectMember(button.dataset.member)));
}

function selectMember(id){
  state.selected=id;state.route=false;
  const member=current();state.bearing=member.bearing;state.live=member.live;
  $("targetInitials").textContent=member.initials;$("targetName").textContent=member.name;
  $("distanceValue").textContent=`${member.distance} m`;$("accuracyValue").textContent=`Precisión ±${member.accuracy} m`;
  $("routeButton").textContent=`Trazar ruta hacia ${member.name}`;$("routeButton").classList.remove("active");
  $("guideArrow").classList.remove("active");$("guidance").classList.add("hidden");renderMembers();renderStatus();updateGuide();
}

function toggleRoute(){
  state.route=!state.route;const member=current();
  $("routeButton").textContent=state.route?"Detener indicaciones":`Trazar ruta hacia ${member.name}`;
  $("routeButton").classList.toggle("active",state.route);$("guideArrow").classList.toggle("active",state.route);$("guidance").classList.toggle("hidden",!state.route);updateGuide();
}

function turn(amount){state.heading=normalize(state.heading+amount);updateGuide();}

function updateGuide(){
  const turn=difference(current().bearing,state.heading);$("guideArrow").style.transform=`rotate(${turn}deg)`;
  if(!state.route)return;const abs=Math.abs(turn);let text="Sigue recto",icon="↑";
  if(abs>135){text="Vas en dirección equivocada · da la vuelta";icon="↶";if("vibrate" in navigator)navigator.vibrate([80,60,80]);}
  else if(abs>45){text=turn<0?"Camina hacia la izquierda":"Camina hacia la derecha";icon=turn<0?"←":"→";}
  else if(abs>15){text=turn<0?"Ve ligeramente a la izquierda":"Ve ligeramente a la derecha";icon=turn<0?"↖":"↗";}
  $("guidanceText").textContent=text;$("guidanceIcon").textContent=icon;$("guidanceDetail").textContent=abs<=15?"Mantén esta dirección":`Gira aproximadamente ${Math.round(abs)}°`;
}

function toggleLive(){const member=current();member.live=!member.live;state.live=member.live;renderMembers();renderStatus();toast(`${member.name} ahora está ${member.live?"Live":"Offline"}`);}
function renderStatus(){const member=current();$("liveLabel").textContent=member.live?"Live":"Offline";document.querySelector(".live-dot").classList.toggle("offline",!member.live);$("updatedLabel").textContent=member.live?"Actualizada ahora":"Última ubicación · hace 1 min";}
function current(){return members.find(member=>member.id===state.selected);}
function expiry(){const value=Number($("durationValue").value);return Date.now()+value*($("durationUnit").value==="days"?86400000:3600000);}
function normalize(angle){return((angle%360)+360)%360;}
function difference(target,origin){return((target-origin+540)%360)-180;}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600);}
function friendlyError(error){return error?.message?.replace("Invitation not found or expired","Invitación inexistente o vencida")||"Ocurrió un error inesperado";}
function escapeHtml(value){const div=document.createElement("div");div.textContent=value;return div.innerHTML;}

if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js"));
