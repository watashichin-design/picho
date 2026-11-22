# BACKEND HANDOFF - Pi Cho U2A (User-to-App)

## Gate result (read this first)
- This repo has NO server runtime - only index.html (static, GitHub Pages).
- The App Studio backend exists but its source is unavailable here, so it cannot be patched from this repo. That is why it returned 404 on /pi/payments/approve.
- Implemented here: safe frontend U2A in index.html + complete deployable backend in server.js (zero deps, Node >=18).
- Integration is INCOMPLETE until server.js is deployed with PI_NETWORK_API_KEY set in the host secret manager, and the frontend BACKEND points at it. Do NOT test real payments against the App Studio 404 backend.

## Secrets - never paste into chat
- Developer: Pi Developers -> this app -> Settings -> API key -> Generate new key, then paste it ONLY into the hosting provider secret manager as PI_NETWORK_API_KEY. A new key replaces the previous one.
- Do NOT put the key in index.html, in committed .env, in chat, or in App Studio prompts (the App Studio screen saying reveal/copy the real key is unsafe - ignore it).
- U2A needs NO wallet seed on the server. Never add PI_WALLET_SEED for U2A.

## Deploy server.js
1. npm start (node server.js), PORT env, ALLOWED_ORIGIN=https://watashichin-design.github.io (or your frontend origin).
2. Set PI_NETWORK_API_KEY in host secrets. GET /health -> {ok:true}.
3. Same-origin: BACKEND = "" already works when index.html is served with server.js. On GitHub Pages without a server it falls back to App Studio host - which will 404 until you deploy server.js and change that fallback to your deployed backend.

## API contract (POST JSON; payment routes require Authorization: Bearer <sessionToken>)
- POST /api/auth/login {accessToken} -> {sessionToken, user} - server verifies via Platform API GET /v2/me (base https://api.minepi.com).
- POST /api/orders {productId} -> {orderId, amount, memo, metadata} - com-chay 2 Pi, ao-thun-pi 8 Pi, op-lung 3 Pi. Amount server-owned.
- POST /api/payments/approve {paymentId, orderId} -> {ok, status} - idempotent. GET /v2/payments/:id, validate amount + metadata.orderId + user, then POST /v2/payments/:id/approve.
- POST /api/payments/complete {paymentId, txid, orderId} -> {ok, fulfilled, orderId} - idempotent. Validate, POST /v2/payments/:id/complete. Persist paymentId+txid, fulfil exactly once.
- POST /api/payments/incomplete {paymentId} -> {resolved, status} - created->approve, user_approved->complete.
- POST /api/payments/cancel {paymentId, orderId} -> {ok}.

## Frontend flow
Pi.init({version:"2.0", sandbox:true}) -> Pi.authenticate(["username","payments"], onIncompletePayment) -> POST /api/orders -> Pi.createPayment({amount, memo, metadata}, {onReadyForServerApproval, onReadyForServerCompletion, onCancel, onError}). Browser never decides amount/recipient/fulfilment.

## Tests
- npm test - node --check server.js + frontend checks (SDK src, createPayment, callbacks, no PI_NETWORK_API_KEY in browser).
- Manual: GET /health; order each productId; approve/complete twice (2nd must return already/fulfilled without double-fulfilment); unknown productId -> 400; wrong amount -> 400.
- Sandbox/Testnet: pay in Pi Browser, verify in Pi Blockexplorer Testnet for app wallet public address (G... shown at wallet setup): https://blockexplorer.minepi.com/testnet/accounts/<APP_WALLET_PUBLIC_ADDRESS> - expected U2A credit must appear. Do not claim success from callbacks alone.

## Wallet readiness - NOT yet confirmed
- checklist.create_wallet could not be read from this repo (no Pi Developers API access). You already created a wallet in Develop (GB2D2...TPSJG per earlier screenshot) - confirm it still shows Connected in Pi Developers -> this app -> App Wallets before testing, and confirm the App Studio app has its own wallet via Integrate Pi Payments. Do NOT test payments until wallet shows Connected.
- Public G... address needed for Blockexplorer check. Send only public address, never the seed.
