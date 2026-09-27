import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/mongodb.js';

const root = process.cwd();
const dataDir = path.join(root, 'data');

function load(name) {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function normalize(doc) {
  const out = {...doc};
  for (const k of ['created_at','expired_at','paid_at','canceled_at','suspended_at','completed_at','failed_at','processed_at','last_h2h_check','timestamp']) {
    if (out[k]) out[k] = new Date(out[k]);
  }
  return out;
}

async function run() {
  const db = await getDb();
  const collections = ['users','deposits','withdrawals','chats'];
  for (const c of collections) {
    const docs = load(`${c}.json`);
    if (!docs.length) continue;
    const col = db.collection(c);
    for (const doc of docs.map(normalize)) {
      const key = doc.id != null ? {id:doc.id} : {_id:doc._id};
      await col.updateOne(key, {$set:doc, $setOnInsert:{created_at:doc.created_at || new Date()}}, {upsert:true});
    }
    console.log(`✅ ${c}: ${docs.length} data diproses.`);
  }
  console.log('✅ Migrasi JSON → MongoDB selesai.');
  process.exit(0);
}
run().catch(e => { console.error('❌ Migrasi gagal:', e); process.exit(1); });
