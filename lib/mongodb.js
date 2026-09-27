import { MongoClient } from 'mongodb';

let clientPromise = null;
let dbPromise = null;
let indexesPromise = null;

function getMongoClient() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI belum dikonfigurasi.');
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 20),
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 0),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000),
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 10000),
      retryWrites: true,
    });
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = getMongoClient().then(client =>
      client.db(process.env.MONGODB_DB_NAME || 'felixpay')
    );
  }
  return dbPromise;
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = getDb().then(async db => {
      const specs = [
        ['users', { username: 1 }, { unique: true }],
        ['users', { api_key: 1 }, { unique: true }],
        ['deposits', { id: 1 }, { unique: true }],
        ['deposits', { user_id: 1, status: 1, expired_at: 1 }],
        ['deposits', { status: 1, expired_at: 1 }],
        ['withdrawals', { id: 1 }, { unique: true }],
        ['withdrawals', { user_id: 1, status: 1 }],
        ['withdrawals', { status: 1, type: 1 }],
        ['chats', { user_id: 1, created_at: 1 }],
        ['mutation_log', { mut_key: 1 }, { unique: true }],
        ['ip_register_log', { ip: 1, created_at: 1 }],
        ['rate_limit_log', { bucket: 1, rkey: 1, created_at: 1 }],
      ];
      for (const [name, key, options] of specs) {
        try { await db.collection(name).createIndex(key, options); } catch (e) {
          if (e?.code !== 85 && e?.code !== 86) console.warn(`MongoDB index ${name} warning:`, e.message);
        }
      }
      return db;
    });
  }
  return indexesPromise;
}

function stripId(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  delete out._id;
  return out;
}

function normalizeValue(v) {
  if (v instanceof Date) return v;
  return v;
}

function normalizeFieldValue(field, value) {
  if (value == null) return value;
  if (['id', 'user_id', 'target_user_id'].includes(field) && /^-?\d+$/.test(String(value))) return Number(value);
  return normalizeValue(value);
}

function projectionFromSelect(sel) {
  if (!sel || sel === '*') return null;
  const fields = String(sel).split(',').map(s => s.trim()).filter(Boolean);
  if (!fields.length) return null;
  const p = {};
  for (const f of fields) p[f] = 1;
  return p;
}

function buildFilter(conditions) {
  const filter = {};
  for (const c of conditions) {
    const { field, op, value } = c;
    if (op === 'eq') filter[field] = normalizeFieldValue(field, value);
    else if (op === 'neq') filter[field] = { ...(filter[field] || {}), $ne: normalizeFieldValue(field, value) };
    else if (op === 'gt') filter[field] = { ...(filter[field] || {}), $gt: normalizeFieldValue(field, value) };
    else if (op === 'gte') filter[field] = { ...(filter[field] || {}), $gte: normalizeFieldValue(field, value) };
    else if (op === 'lt') filter[field] = { ...(filter[field] || {}), $lt: normalizeFieldValue(field, value) };
    else if (op === 'lte') filter[field] = { ...(filter[field] || {}), $lte: normalizeFieldValue(field, value) };
    else if (op === 'ilike') filter[field] = { $regex: String(value), $options: 'i' };
    else if (op === 'not') {
      if (value === null && c.extra === 'is') filter[field] = { $exists: true, $ne: null };
      else if (c.extra === 'is') filter[field] = { $ne: normalizeFieldValue(field, value) };
    }
  }
  return filter;
}

class Query {
  constructor(table) {
    this.table = table;
    this.conditions = [];
    this._projection = null;
    this._sort = null;
    this._limit = null;
    this._skip = 0;
    this._count = false;
    this._head = false;
    this._action = 'select';
    this._payload = null;
    this._returnRows = false;
  }

  select(fields='*', options={}) {
    this._projection = projectionFromSelect(fields);
    if (options?.count === 'exact') this._count = true;
    if (options?.head) this._head = true;
    if (this._action === 'update' || this._action === 'insert' || this._action === 'upsert') this._returnRows = true;
    return this;
  }
  eq(field, value) { this.conditions.push({field,op:'eq',value}); return this; }
  neq(field, value) { this.conditions.push({field,op:'neq',value}); return this; }
  ilike(field, value) {
    const raw = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.conditions.push({field,op:'ilike',value:raw}); return this;
  }
  gt(field, value) { this.conditions.push({field,op:'gt',value}); return this; }
  gte(field, value) { this.conditions.push({field,op:'gte',value}); return this; }
  lt(field, value) { this.conditions.push({field,op:'lt',value}); return this; }
  lte(field, value) { this.conditions.push({field,op:'lte',value}); return this; }
  not(field, op, value) { this.conditions.push({field,op:'not',extra:op,value}); return this; }
  order(field, {ascending=true}={}) { this._sort = { [field]: ascending ? 1 : -1 }; return this; }
  limit(n) { this._limit = Number(n); return this; }
  range(from, to) { this._skip = Number(from); this._limit = Number(to) - Number(from) + 1; return this; }
  maybeSingle() { this._single = true; return this; }
  single() { this._single = true; return this; }
  insert(payload) { this._action='insert'; this._payload=payload; return this; }
  update(payload) { this._action='update'; this._payload=payload; return this; }
  upsert(payload) { this._action='upsert'; this._payload=payload; return this; }
  delete() { this._action='delete'; return this; }

  async execute() {
    const db = await ensureIndexes();
    const col = db.collection(this.table);
    const filter = buildFilter(this.conditions);
    try {
      if (this._action === 'select') {
        let cursor = col.find(filter, this._projection ? {projection:this._projection} : {});
        if (this._sort) cursor = cursor.sort(this._sort);
        if (this._skip) cursor = cursor.skip(this._skip);
        if (this._limit != null) cursor = cursor.limit(this._limit);
        const docs = this._head ? [] : await cursor.toArray();
        const count = this._count ? await col.countDocuments(filter) : undefined;
        const data = this._single ? (docs[0] ? stripId(docs[0]) : null) : docs.map(stripId);
        return { data, error:null, ...(this._count ? {count} : {}) };
      }

      if (this._action === 'insert') {
        const items = Array.isArray(this._payload) ? this._payload : [this._payload];
        const prepared = items.map(x => {
          const doc = {...x, created_at: x.created_at ? new Date(x.created_at) : (x.created_at === null ? null : new Date())};
          if (this.table === 'users' && doc.id == null) doc.id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
          return doc;
        });
        // Preserve explicitly supplied IDs. Otherwise Mongo's _id is enough.
        const result = await col.insertMany(prepared, {ordered:true});
        const data = this._returnRows ? prepared.map(stripId) : null;
        return {data, error:null, count:result.insertedCount};
      }

      if (this._action === 'upsert') {
        const items = Array.isArray(this._payload) ? this._payload : [this._payload];
        const results=[];
        for (const item of items) {
          const key = item.id != null ? {id:item.id} : (item.username ? {username:item.username} : {_id:item._id});
          const doc = {...item};
          if (!doc.created_at) doc.created_at = new Date();
          await col.updateOne(key, {$set:doc, $setOnInsert:{created_at:doc.created_at}}, {upsert:true});
          results.push(doc);
        }
        return {data:this._returnRows ? results.map(stripId) : null,error:null};
      }

      if (this._action === 'update') {
        const update = {$set: {...this._payload}};
        const r = await col.updateMany(filter, update);
        let data = null;
        if (this._returnRows) {
          const docs = await col.find(filter, this._projection ? {projection:this._projection} : {}).toArray();
          data = docs.map(stripId);
        }
        return {data,error:null,count:r.modifiedCount};
      }

      if (this._action === 'delete') {
        const r = await col.deleteMany(filter);
        return {data:null,error:null,count:r.deletedCount};
      }
    } catch (error) {
      return {data:null,error};
    }
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

function from(table) { return new Query(table); }

async function rpc(fn, args={}) {
  const db = await ensureIndexes();
  const users = db.collection('users');
  const deposits = db.collection('deposits');
  const now = new Date();

  try {
    if (fn === 'cancel_deposit_atomic') {
      const r = await deposits.findOneAndUpdate(
        {id:args.p_deposit_id,user_id:args.p_user_id,status:'pending',expired_at:{$gt:now}},
        {$set:{status:'canceled',canceled_at:now}},
        {returnDocument:'after'}
      );
      const doc = r?.value ?? r;
      return {data:doc ? [{id:doc.id,status:doc.status}] : [],error:null};
    }

    if (fn === 'expire_deposit_atomic') {
      const r = await deposits.findOneAndUpdate(
        {id:args.p_deposit_id,status:'pending',expired_at:{$lte:now}},
        {$set:{status:'expired'}},
        {returnDocument:'after'}
      );
      const doc = r?.value ?? r;
      return {data:doc ? [{id:doc.id,status:doc.status}] : [],error:null};
    }

    if (fn === 'deduct_balance_atomic') {
      const r = await users.findOneAndUpdate(
        {id:args.p_user_id,balance:{$gte:Number(args.p_amount)}},
        {$inc:{balance:-Number(args.p_amount)}},
        {returnDocument:'after'}
      );
      const doc = r?.value ?? r;
      return {data:doc ? [{id:doc.id,balance:doc.balance}] : [],error:null};
    }

    if (fn === 'refund_balance_atomic') {
      const r = await users.findOneAndUpdate(
        {id:args.p_user_id},
        {$inc:{balance:Number(args.p_amount)}},
        {returnDocument:'after'}
      );
      const doc = r?.value ?? r;
      return {data:doc ? [{id:doc.id,balance:doc.balance}] : [],error:null};
    }

    if (fn === 'credit_deposit_atomic') {
      const d = await deposits.findOneAndUpdate(
        {id:args.p_deposit_id,status:'pending'},
        {$set:{status:'success',paid_at:now,mutation_key:args.p_mutation_key}},
        {returnDocument:'after'}
      );
      const deposit = d?.value ?? d;
      if (!deposit) return {data:[],error:null};
      const u = await users.findOneAndUpdate(
        {id:deposit.user_id},
        {$inc:{balance:Number(deposit.amount)}},
        {returnDocument:'after'}
      );
      const user = u?.value ?? u;
      if (!user) {
        await deposits.updateOne({id:deposit.id,status:'success',mutation_key:args.p_mutation_key},{$set:{status:'pending'},$unset:{paid_at:'',mutation_key:''}});
        return {data:[],error:new Error('User tidak ditemukan saat credit deposit')};
      }
      return {data:[{user_id:user.id,new_balance:user.balance}],error:null};
    }

    return {data:null,error:new Error(`RPC MongoDB tidak dikenal: ${fn}`)};
  } catch (error) {
    return {data:null,error};
  }
}

export const mongoAdmin = { from, rpc };
export { getDb };
