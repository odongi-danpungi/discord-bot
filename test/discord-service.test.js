import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, ChannelType, EmbedBuilder, ActionRowBuilder } from 'discord.js';
import { DiscordService } from '../src/discord-service.js';
import { recruitmentCard, attendanceCard } from '../src/messages.js';
import { applyAction } from '../src/operations.js';
function fixture(){
 const state={history:[],session:null},sent=[],edited=[],cache=new Collection();let next=0;
 const channel=(name,type,parentId=null)=>{
   const messages=new Map(),c={id:String(++next),name,type,parentId,permissionsFor:()=>({has:()=>true}),setName:async value=>{c.name=value;},messages:{fetch:async id=>{if(!messages.has(id))throw Object.assign(Error('missing'),{code:10008});return messages.get(id)}},send:async payload=>{const m={id:'m'+(++next),edit:async p=>{edited.push(p);}};messages.set(m.id,m);sent.push(payload);return m;}};cache.set(c.id,c);return c;
 };
 const category=channel('🎮 시참',ChannelType.GuildCategory);channel('🎟️・시참',ChannelType.GuildText,category.id);channel('⚔️・내전',ChannelType.GuildText,category.id);channel('📜・로그',ChannelType.GuildText,category.id);
 const guild={channels:{fetch:async()=>cache,create:async data=>channel(data.name,data.type,data.parent)},members:{me:{permissions:{has:()=>true}}}};
 const client={user:{id:'bot'},guilds:{fetch:async()=>guild}},operations={read:()=>structuredClone(state),update:async fn=>fn(state)};
 const service=new DiscordService(client,'g',operations);return {state,sent,edited,cache,service};
}
test('recruitment edits reuse message IDs, close buttons, and repeated setup does not duplicate panels',async()=>{
 const f=fixture();applyAction(f.state,'open',{game:'lol',count:1});await f.service.sync('open');const first=f.state.session.messages.recruitment;
 applyAction(f.state,'join',{sessionId:f.state.session.id,userId:'a'});await f.service.sync('sync');assert.deepEqual(f.state.session.messages.recruitment,first);assert.ok(f.edited.at(-1).embeds[0].fields[0].value.includes('신청 1명'));
 applyAction(f.state,'close');await f.service.sync('close');assert.ok(f.edited.at(-1).components[0].components.every(b=>b.disabled));
 await f.service.setup();const panel=f.state.panel,count=f.cache.size;await f.service.setup();assert.deepEqual(f.state.panel,panel);assert.equal(f.cache.size,count);
});
test('Discord payloads obey component and embed limits even at maximum roster size',()=>{
 const state={history:[],session:null};applyAction(state,'open',{game:'lol',count:50,title:'한'.repeat(256),description:'글'.repeat(4000)});
 const card=recruitmentCard(state.session);assert.doesNotThrow(()=>new EmbedBuilder(card.embeds[0]).toJSON());assert.doesNotThrow(()=>ActionRowBuilder.from(card.components[0]).toJSON());
 for(let i=0;i<50;i++)applyAction(state,'join',{sessionId:state.session.id,userId:'12345678901234567'+String(i).padStart(2,'0')});
 applyAction(state,'close');applyAction(state,'draw');applyAction(state,'attendance',{minutes:1});const attendance=attendanceCard(state.session);assert.ok(attendance.content.length<=2000);assert.ok(attendance.components[0].components[0].custom_id.length<=100);
});
