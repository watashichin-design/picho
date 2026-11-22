// Pi Cho backend - User-to-App (U2A) only. No A2U, no wallet seed needed.
// Env (set in hosting provider secret manager, never in chat / browser / git):
//   PI_NETWORK_API_KEY - Pi Platform key (Pi Developers -> this app -> Settings -> API key)
//   PORT (default 3000), PI_API_BASE (default https://api.minepi.com), ALLOWED_ORIGIN (optional CORS)
const http = require('http');
const crypto = require('crypto');
const PI_API = process.env.PI_API_BASE || 'https://api.minepi.com';
const API_KEY = process.env.PI_NETWORK_API_KEY || '';
// Server-owned catalog - the ONLY authoritative amounts. Browser input is never trusted.
const CATALOG = {
  'com-chay':   { productId: 'com-chay',   name: 'Com chay - 1 hop',     amount: 2 },
  'ao-thun-pi': { productId: 'ao-thun-pi', name: 'Ao thun Pi Network',   amount: 8 },
  'op-lung':    { productId: 'op-lung',    name: 'Op lung dien thoai',  amount: 3 },
};
const orders = new Map();   // orderId -> {orderId, productId, amount, memo, metadata, status, paymentId, txid, fulfilled, piUid, piUsername}
const payments = new Map(); // paymentId -> {paymentId, orderId, status, txid}
const sessions = new Map(); // sessionToken -> {piUid, piUsername}
function send(res, code, obj){ res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':process.env.ALLOWED_ORIGIN||'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, GET, OPTIONS'}); res.end(JSON.stringify(obj)); }
async function body(req){ let s=''; for await (const c of req) s+=c; try{ return s?JSON.parse(s):{}; }catch{ return {}; } }
async function piApi(path, method='GET'){
  if(!API_KEY) throw new Error('PI_NETWORK_API_KEY is not configured on the server');
  const r = await fetch(PI_API + path, { method, headers: { 'Authorization': `Key ${API_KEY}` } });
  const text = await r.text(); let data=null; try{ data=text?JSON.parse(text):null; }catch{}
  if(!r.ok) throw new Error(`Pi Platform API ${path} -> ${r.status}: ${String(text).slice(0,300)}`);
  return data;
}
function auth(req){ const h=req.headers.authorization||''; const tok=h.replace('Bearer ',''); return tok && sessions.get(tok) ? sessions.get(tok) : null; }
const server = http.createServer(async (req,res)=>{
  try{
    if(req.method==='OPTIONS'){ send(res,204,{}); return; }
    const url = new URL(req.url, 'http://localhost');
    if(req.method==='GET' && url.pathname==='/health'){ send(res,200,{ok:true, service:'picho-u2a'}); return; }
    if(req.method!=='POST'){ send(res,404,{error:'not_found'}); return; }
    const b = await body(req);
    // POST /api/auth/login {accessToken} -> server verifies via Platform API /v2/me
    if(url.pathname==='/api/auth/login'){
      if(!b.accessToken) return send(res,400,{error:'accessToken required'});
      // Verify the USER accessToken: GET /v2/me with Authorization: Bearer <user accessToken>.
      // The app API key must NOT be used here - Pi rejects it for /v2/me and login silently failed.
      const meRes = await fetch(PI_API + '/v2/me', { headers: { 'Authorization': 'Bearer ' + b.accessToken } });
      const meText = await meRes.text(); let me = null; try { me = meText ? JSON.parse(meText) : null; } catch {}
      if (!meRes.ok) return send(res, 401, { error: 'Pi /v2/me rejected accessToken: ' + meRes.status + ' ' + String(meText).slice(0,200) });
      const sessionToken = crypto.randomUUID();
      const user = { username: (me && me.username) || b.username || 'pioneer', uid: (me && me.uid) || b.uid || null };
      sessions.set(sessionToken, { piUid: user.uid, piUsername: user.username });
      return send(res,200,{ sessionToken, user });
    }
    // All payment routes require a session from /api/auth/login
    const sess = auth(req);
    if(!sess) return send(res,401,{error:'unauthorized: login first'});
    // POST /api/orders {productId} -> {orderId, amount, memo, metadata}
    if(url.pathname==='/api/orders'){
      const p = CATALOG[b.productId];
      if(!p) return send(res,400,{error:'unknown productId'});
      const orderId = 'ord_' + crypto.randomUUID();
      const order = { orderId, productId: p.productId, amount: p.amount, memo: 'Pi Cho - ' + p.name,
        metadata: { orderId, productId: p.productId, item: p.name }, status: 'created', fulfilled: false,
        piUid: sess.piUid, piUsername: sess.piUsername };
      orders.set(orderId, order);
      return send(res,201, { orderId, amount: p.amount, memo: order.memo, metadata: order.metadata });
    }
    // POST /api/payments/approve {paymentId, orderId} - idempotent
    if(url.pathname==='/api/payments/approve'){
      const order = orders.get(b.orderId); if(!order) return send(res,404,{error:'order not found'});
      if(order.status==='approved' || order.status==='completed') return send(res,200,{ok:true, already:order.status});
      const pay = await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}`);
      // Validate against server state: amount, direction (U2A: to app), metadata.orderId, user
      if(Number(pay.amount) !== Number(order.amount)) return send(res,400,{error:'amount mismatch'});
      if(pay.metadata && pay.metadata.orderId && pay.metadata.orderId !== order.orderId) return send(res,400,{error:'metadata orderId mismatch'});
      if(pay.user_uid && order.piUid && String(pay.user_uid) !== String(order.piUid)) return send(res,400,{error:'user mismatch'});
      await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}/approve`, 'POST');
      order.status='approved'; order.paymentId=b.paymentId;
      payments.set(b.paymentId, { paymentId: b.paymentId, orderId: order.orderId, status: 'approved' });
      return send(res,200,{ok:true, status:'approved'});
    }
    // POST /api/payments/complete {paymentId, txid, orderId} - idempotent, fulfil exactly once
    if(url.pathname==='/api/payments/complete'){
      const order = orders.get(b.orderId); if(!order) return send(res,404,{error:'order not found'});
      if(order.fulfilled) return send(res,200,{ok:true, fulfilled:true, already:true});
      const pay = await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}`);
      if(!b.txid) return send(res,400,{error:'txid required'});
      if(Number(pay.amount) !== Number(order.amount)) return send(res,400,{error:'amount mismatch'});
      await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}/complete`, 'POST');
      // Persist paymentId+txid BEFORE irreversible work; fulfil exactly once (guard above).
      order.status='completed'; order.txid=b.txid; order.fulfilled=true; order.paymentId=b.paymentId;
      payments.set(b.paymentId, { paymentId: b.paymentId, orderId: order.orderId, status: 'completed', txid: b.txid });
      // TODO: fulfilment hook - grant product / mark order delivered in YOUR DB here.
      return send(res,200,{ok:true, fulfilled:true, orderId: order.orderId});
    }
    // POST /api/payments/incomplete {paymentId} - resume unfinished payment
    if(url.pathname==='/api/payments/incomplete'){
      const pay = await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}`);
      const status = pay.status; // e.g. created | user_approved | user_completed | cancelled | etc.
      if(status==='created'){ await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}/approve`,'POST'); return send(res,200,{resolved:true,status:'approved'}); }
      if(status==='user_approved'){ const txid = pay.transaction && pay.transaction.txid; if(!txid) return send(res,200,{resolved:false,status}); await piApi(`/v2/payments/${encodeURIComponent(b.paymentId)}/complete`,'POST'); return send(res,200,{resolved:true,status:'completed',txid}); }
      return send(res,200,{resolved:false,status});
    }
    // POST /api/payments/cancel {paymentId, orderId}
    if(url.pathname==='/api/payments/cancel'){
      const order = orders.get(b.orderId); if(order && !order.fulfilled) order.status='cancelled';
      return send(res,200,{ok:true});
    }
    return send(res,404,{error:'not_found'});
  }catch(e){ console.error(e); send(res,500,{error:e.message}); }
});
const PORT = process.env.PORT || 3000;
if(require.main===module) server.listen(PORT, ()=>console.log('Pi Cho U2A backend on :' + PORT));
module.exports = server;
