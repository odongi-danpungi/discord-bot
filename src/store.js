import { JsonStore } from './json-store.js';
export class RegistrationStore extends JsonStore {
  constructor(file) { super(file, [], value => Array.isArray(value) && value.every(r => r && typeof r.guildId === 'string' && typeof r.discordId === 'string')); }
  async all() { return this.read(); }
  async upsert(record) {
    return this.update(records => {
      const i = records.findIndex(r => r.guildId === record.guildId && r.discordId === record.discordId);
      if (i < 0) records.push(record); else records[i] = { ...records[i], ...record };
    });
  }
  async remove(guildId, discordId) {
    return this.update(records => { const i = records.findIndex(r => r.guildId === guildId && r.discordId === discordId); if (i >= 0) records.splice(i, 1); });
  }
}
