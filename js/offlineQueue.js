(function () {
    const DB_NAME = 'truckcar-offline';
    const DB_VERSION = 1;
    const BATCH_SIZE = 100;
    const BASE_DELAY_MS = 2000;
    const MAX_DELAY_MS = 5 * 60 * 1000;
    const PERIODIC_MS = 30 * 1000;
    const ENDPOINTS = {
        'position': '/fleets-drivers/sync/batch',
        'trip.started': '/loads/sync/batch',
        'trip.delivered': '/loads/sync/batch',
        'alert.reported': '/alerts/sync/batch',
        'alert.confirmed': '/alerts/sync/batch',
        'alert.sos': '/alerts/sync/batch'
    };

    let dbPromise = null;
    let flushing = null;
    let retryTimer = null;
    let attempt = 0;
    const listeners = new Set();
    const status = { pending: 0, byKind: {}, lastSyncAt: null, lastError: null, rejected: [], nextRetryAt: null };

    function openDb() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    const outbox = db.createObjectStore('outbox', { keyPath: 'clientEventId' });
                    outbox.createIndex('byOccurredAt', 'occurredAt');
                    db.createObjectStore('media', { keyPath: 'mediaId' });
                    db.createObjectStore('meta', { keyPath: 'key' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return dbPromise;
    }

    function done(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transacción de IndexedDB abortada'));
        });
    }

    function result(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function uuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        const b = window.crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    function isOffline() {
        return !navigator.onLine || !!(window.store && window.store.state && window.store.state.isOffline);
    }

    function isConnectivityError(error) {
        return !!error && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
    }

    function isPermanent(error) {
        const s = error && error.status;
        return s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429;
    }

    async function enqueue(kind, payload, options = {}) {
        if (!ENDPOINTS[kind]) throw new Error('Tipo de evento offline desconocido: ' + kind);
        const db = await openDb();
        const tripKey = 'seq:' + (options.tripId == null ? 'none' : options.tripId);
        const tx = db.transaction(['outbox', 'media', 'meta'], 'readwrite');
        const meta = tx.objectStore('meta');
        const current = await result(meta.get(tripKey));
        const seq = (current ? current.value : 0) + 1;
        meta.put({ key: tripKey, value: seq });

        const mediaRefs = {};
        Object.entries(options.media || {}).forEach(([name, blob]) => {
            if (!blob) return;
            const mediaId = uuid();
            tx.objectStore('media').put({ mediaId, blob, type: blob.type, size: blob.size });
            mediaRefs[name] = mediaId;
        });
        const event = {
            clientEventId: options.clientEventId || uuid(),
            kind,
            occurredAt: new Date().toISOString(),
            seq,
            tripId: options.tripId == null ? null : options.tripId,
            payload,
            media: Object.keys(mediaRefs).length ? mediaRefs : null,
            attempts: 0
        };
        tx.objectStore('outbox').put(event);
        await done(tx);
        await refreshStatus();
        if (!isOffline()) scheduleFlush(0);
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then(reg => {
                reg.sync.register('truckcar-outbox-sync').catch(() => {});
            }).catch(() => {});
        }
        return event;
    }

    function flush() {
        if (flushing) return flushing;
        const run = () => doFlush().finally(() => { flushing = null; });
        flushing = navigator.locks && navigator.locks.request
            ? navigator.locks.request('truckcar-outbox-flush', run)
            : run();
        return flushing;
    }

    async function doFlush() {
        if (isOffline()) return;
        const api = window.TruckCarApi;
        if (!api || !api.session.isRenewable()) return;
        clearTimeout(retryTimer);
        status.nextRetryAt = null;
        try {
            const events = await pendingEvents();
            for (const [endpoint, group] of groupByEndpoint(events)) {
                for (let i = 0; i < group.length; i += BATCH_SIZE) {
                    let batch = group.slice(i, i + BATCH_SIZE);
                    const dropped = [];
                    for (const event of batch) {
                        if (event.kind !== 'trip.delivered' || !event.media) continue;
                        try {
                            await uploadDeliveryEvidence(event);
                        } catch (error) {
                            if (!isPermanent(error)) throw error;
                            dropped.push({ clientEventId: event.clientEventId, reason: error.message });
                        }
                    }
                    if (dropped.length) {
                        await settle(batch, { rejected: dropped });
                        batch = batch.filter(e => !dropped.some(d => d.clientEventId === e.clientEventId));
                        if (!batch.length) continue;
                    }
                    let response;
                    try {
                        response = await api.http.post(endpoint, {
                            events: batch.map(e => ({
                                clientEventId: e.clientEventId,
                                kind: e.kind,
                                occurredAt: e.occurredAt,
                                seq: e.seq,
                                payload: e.payload
                            }))
                        });
                    } catch (error) {
                        if (error.status !== 400) throw error;
                        response = { rejected: batch.map(e => ({ clientEventId: e.clientEventId, reason: error.message })) };
                    }
                    await settle(batch, response || {});
                }
            }
            attempt = 0;
            status.lastSyncAt = new Date().toISOString();
            status.lastError = null;
        } catch (error) {
            attempt += 1;
            status.lastError = (error && error.message) || String(error);
            scheduleFlush(backoffDelay(attempt));
        } finally {
            await refreshStatus();
        }
    }

    function backoffDelay(n) {
        const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, n - 1));
        return Math.round(exponential / 2 + Math.random() * exponential / 2);
    }

    function scheduleFlush(delayMs) {
        clearTimeout(retryTimer);
        status.nextRetryAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;
        retryTimer = setTimeout(() => flush(), delayMs);
    }

    async function pendingEvents() {
        const db = await openDb();
        const tx = db.transaction('outbox', 'readonly');
        const events = await result(tx.objectStore('outbox').index('byOccurredAt').getAll());
        return events.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.seq - b.seq));
    }

    function groupByEndpoint(events) {
        const sos = events.filter(event => event.kind === 'alert.sos');
        const groups = new Map();
        ['/loads/sync/batch', '/fleets-drivers/sync/batch', '/alerts/sync/batch'].forEach(e => groups.set(e, []));
        events.filter(event => event.kind !== 'alert.sos').forEach(event => groups.get(ENDPOINTS[event.kind]).push(event));
        return [['/alerts/sync/batch', sos], ...groups.entries()].filter(([, group]) => group.length);
    }

    async function settle(batch, response) {
        const done_ = new Set([...(response.accepted || []), ...(response.duplicates || [])]);
        const rejected = new Map((response.rejected || []).map(r => [r.clientEventId, r.reason]));
        const db = await openDb();
        const tx = db.transaction(['outbox', 'media'], 'readwrite');
        batch.forEach(event => {
            if (done_.has(event.clientEventId) || rejected.has(event.clientEventId)) {
                tx.objectStore('outbox').delete(event.clientEventId);
                Object.values(event.media || {}).forEach(mediaId => tx.objectStore('media').delete(mediaId));
            }
            if (rejected.has(event.clientEventId)) {
                status.rejected.unshift({ kind: event.kind, occurredAt: event.occurredAt, reason: rejected.get(event.clientEventId) });
            }
        });
        status.rejected = status.rejected.slice(0, 10);
        await done(tx);
        if (rejected.size) {
            window.dispatchEvent(new CustomEvent('truckcar:sync-rejected', { detail: [...rejected.values()] }));
        }
    }

    async function uploadDeliveryEvidence(event) {
        const db = await openDb();
        const blobs = {};
        for (const [name, mediaId] of Object.entries(event.media)) {
            const record = await result(db.transaction('media', 'readonly').objectStore('media').get(mediaId));
            if (record) blobs[name] = record.blob;
        }
        const references = await window.PodEvidence.upload(event.payload.loadId, blobs);
        event.payload = { ...event.payload, ...references };
        event.media = null;
        const tx = db.transaction(['outbox', 'media'], 'readwrite');
        tx.objectStore('outbox').put(event);
        await done(tx);
    }

    async function refreshStatus() {
        try {
            const events = await pendingEvents();
            status.pending = events.length;
            status.byKind = events.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {});
        } catch (e) {
        }
        listeners.forEach(fn => { try { fn({ ...status }); } catch (e) { } });
    }

    function onChange(fn) {
        listeners.add(fn);
        fn({ ...status });
        return () => listeners.delete(fn);
    }

    window.addEventListener('online', () => { attempt = 0; scheduleFlush(0); });
    setInterval(() => { if (status.pending > 0 && !flushing && !isOffline()) flush(); }, PERIODIC_MS);
    refreshStatus().then(() => { if (status.pending > 0) scheduleFlush(1000); });

    window.OfflineQueue = { enqueue, flush, onChange, isOffline, isConnectivityError, backoffDelay, uuid, status: () => ({ ...status }) };
})();
