const { kv } = require('@vercel/kv');

// Keys that store plain objects instead of arrays
const OBJ_KEYS = new Set(['options_chain', 'stock_prices']);

async function readData(key) {
  try {
    const data = await kv.get(key);
    if (data === null || data === undefined) {
      return OBJ_KEYS.has(key) ? {} : [];
    }
    return data;
  } catch (err) {
    console.error('KV read error:', key, err);
    return OBJ_KEYS.has(key) ? {} : [];
  }
}

async function writeData(key, value) {
  try {
    await kv.set(key, value);
    return true;
  } catch (err) {
    console.error('KV write error:', key, err);
    return false;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, data, status = 200) {
  cors(res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(status).json(data);
}

module.exports = { readData, writeData, sendJson, cors };
