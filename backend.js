import{SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY}from"./config.js";

const configured=Boolean(SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY);
let client=null;

async function getClient(){
  if(!configured)return null;
  if(client)return client;
  const{createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.74.0/+esm");
  client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return client;
}

async function ensureUser(){
  const supabase=await getClient();
  if(!supabase)return null;
  const{data:{session}}=await supabase.auth.getSession();
  if(session?.user)return session.user;
  const{data,error}=await supabase.auth.signInAnonymously();
  if(error)throw error;
  return data.user;
}

async function callRpc(name,args){
  const supabase=await getClient();
  if(!supabase)return null;
  await ensureUser();
  const{data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}

export const backend={
  configured,
  ensureUser,
  async createGroup({name,nickname,expiresAt}){
    return callRpc("create_wayv_group",{event_name:name,creator_nickname:nickname,expires_at:new Date(expiresAt).toISOString()});
  },
  async requestJoin({code,nickname}){
    return callRpc("request_wayv_join",{invitation_code:code,nickname});
  },
  async approveMember(memberId){return callRpc("approve_wayv_member",{target_member_id:memberId});},
  async rejectMember(memberId){return callRpc("reject_wayv_member",{target_member_id:memberId});},
  async leaveGroup(groupId){return callRpc("leave_wayv_group",{target_group_id:groupId});},
  async deleteGroup(groupId){return callRpc("delete_wayv_group",{target_group_id:groupId});},
  async myActiveMembership(){return callRpc("get_my_wayv_membership",{});},
  async pendingMembers(groupId){
    const supabase=await getClient();if(!supabase)return[];
    const{data,error}=await supabase.from("wayv_members").select("id,nickname,created_at").eq("group_id",groupId).eq("status","pending").order("created_at");
    if(error)throw error;return data;
  },
  async groupMembers(groupId){
    const supabase=await getClient();if(!supabase)return[];
    await ensureUser();
    const{data,error}=await supabase.from("wayv_members").select("id,user_id,nickname,role,status,created_at").eq("group_id",groupId).eq("status","approved").order("created_at");
    if(error)throw error;return data||[];
  },
  async groupLocations(groupId){
    const supabase=await getClient();if(!supabase)return[];
    await ensureUser();
    const{data,error}=await supabase.from("wayv_locations").select("user_id,latitude,longitude,accuracy,heading,updated_at").eq("group_id",groupId);
    if(error)throw error;return data||[];
  },
  async updateLocation({groupId,latitude,longitude,accuracy,heading}){
    const supabase=await getClient();if(!supabase)return;
    const user=await ensureUser();
    const{error}=await supabase.from("wayv_locations").upsert({group_id:groupId,user_id:user.id,latitude,longitude,accuracy,heading,updated_at:new Date().toISOString()},{onConflict:"group_id,user_id"});
    if(error)throw error;
  },
  async createMeetingPoint({groupId,latitude,longitude}){
    const supabase=await getClient();if(!supabase)return;
    const user=await ensureUser();
    const{data,error}=await supabase.from("wayv_meeting_points").insert({group_id:groupId,creator_id:user.id,latitude,longitude}).select("id,group_id,creator_id,latitude,longitude,created_at").single();
    if(error)throw error;return data;
  },
  async latestMeetingPoint(groupId){
    const supabase=await getClient();if(!supabase)return null;
    const{data,error}=await supabase.from("wayv_meeting_points").select("id,creator_id,latitude,longitude,created_at").eq("group_id",groupId).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;return data;
  },
  async sendVisibilitySignal({groupId,targetUserId,color}){
    const supabase=await getClient();const user=await ensureUser();
    const{data,error}=await supabase.from("wayv_signals").insert({group_id:groupId,sender_id:user.id,target_user_id:targetUserId,kind:"find_me",color,expires_at:new Date(Date.now()+120000).toISOString()}).select().single();
    if(error)throw error;return data;
  },
  async latestVisibilitySignal(groupId){
    const supabase=await getClient();const user=await ensureUser();
    const{data,error}=await supabase.from("wayv_signals").select("id,sender_id,target_user_id,color,created_at,expires_at").eq("group_id",groupId).eq("target_user_id",user.id).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;return data;
  },
  async subscribeToGroup(groupId,onChange){
    const supabase=await getClient();if(!supabase)return()=>{};
    const channel=supabase.channel(`wayv:${groupId}`).on("postgres_changes",{event:"*",schema:"public",table:"wayv_locations",filter:`group_id=eq.${groupId}`},onChange).on("postgres_changes",{event:"*",schema:"public",table:"wayv_members",filter:`group_id=eq.${groupId}`},onChange).on("postgres_changes",{event:"INSERT",schema:"public",table:"wayv_meeting_points",filter:`group_id=eq.${groupId}`},onChange).on("postgres_changes",{event:"INSERT",schema:"public",table:"wayv_signals",filter:`group_id=eq.${groupId}`},onChange).subscribe();
    return()=>supabase.removeChannel(channel);
  }
};
