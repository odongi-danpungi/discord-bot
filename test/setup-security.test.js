import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Windows setup asks for Discord ids and protects the broadcast token',async()=>{
 const source=await readFile(new URL('../scripts/windows-start.js',import.meta.url),'utf8');
 assert.match(source,/Discord 애플리케이션 ID/);
 assert.match(source,/Discord 서버 ID/);
 assert.match(source,/BROADCAST_TOKEN/);
 assert.match(source,/randomBytes\(24\)/);
 assert.match(source,/config\.BROADCAST_TOKEN/);
 assert.match(source,/DASHBOARD_OPERATOR_PASSWORD/);
 assert.match(source,/config\.DASHBOARD_OPERATOR_PASSWORD/);
 assert.doesNotMatch(source,/DISCORD_CLIENT_ID:[^\n]*\|\|'\d{17,20}'/);
 assert.doesNotMatch(source,/DISCORD_GUILD_ID:[^\n]*\|\|'\d{17,20}'/);
});
