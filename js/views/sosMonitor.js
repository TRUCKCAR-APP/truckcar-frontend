window.SosMonitor = (function () {
    const esc = (value) => window.ui.escape(value);
    const POLL_MS = 5000;
    const TOWER = ['COORDINADOR', 'ADMIN'];
    const DOWN_TEXT = {
        network: {
            title: 'Monitoreo SOS caído',
            body: 'No se pudo consultar la torre (sin conexión o servidor no disponible). Los SOS nuevos no aparecerán hasta que se recupere.'
        },
        auth: {
            title: 'Monitoreo SOS detenido',
            body: 'Su sesión no tiene acceso a las alertas SOS. Vuelva a iniciar sesión.'
        }
    };

    let timer = null;
    let host = null;
    let cards = null;
    let banner = null;
    let list = [];
    let renderedKey = null;
    let fresh = new Set();
    let failures = 0;
    let down = null;
    let lastOkAt = null;
    const known = new Set();
    const busy = new Set();

    function ago(iso) {
        const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
        if (!Number.isFinite(minutes)) return '';
        return minutes < 1 ? 'ahora' : minutes < 60 ? 'hace ' + minutes + ' min' : 'hace ' + Math.round(minutes / 60) + ' h';
    }

    function who(sos) {
        return sos.driverName || sos.driverId || 'Conductor';
    }

    function mapsUrl(sos) {
        return 'https://www.openstreetmap.org/?mlat=' + sos.latitude + '&mlon=' + sos.longitude
            + '#map=16/' + sos.latitude + '/' + sos.longitude;
    }

    function clock(time) {
        return new Date(time).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    function ensureHost() {
        if (host) return host;
        const frame = document.getElementById('phone-mockup-frame');
        if (!frame) return null;
        host = document.createElement('div');
        host.className = 'sos-alerts';
        cards = document.createElement('div');
        cards.className = 'sos-alert-list';
        host.appendChild(cards);
        host.addEventListener('click', (event) => {
            const ack = event.target.closest('[data-sos-ack]');
            const locate = event.target.closest('[data-sos-locate]');
            if (ack) acknowledge(Number(ack.dataset.sosAck));
            if (locate) focusOnMap(Number(locate.dataset.sosLocate));
        });
        frame.appendChild(host);
        return host;
    }

    function cardHtml(sos) {
        return `
            <div class="sos-alert" ${fresh.has(sos.id) ? 'role="alert"' : ''} data-sos-id="${esc(sos.id)}">
                <span class="sos-alert-icon" aria-hidden="true"><i class="fas fa-life-ring"></i></span>
                <div class="min-w-0 flex-1">
                    <b class="block text-[13px] leading-tight truncate">SOS · ${esc(who(sos))}${sos.vehiclePlate ? ' · <span class="font-mono">' + esc(sos.vehiclePlate) + '</span>' : ''}</b>
                    <span class="block text-[11.5px] opacity-90 truncate">
                        ${sos.loadId ? 'CARGA-' + esc(sos.loadId) + ' · ' : ''}<span data-sos-ago>${esc(ago(sos.triggeredAt))}</span> ·
                        <a href="${esc(mapsUrl(sos))}" target="_blank" rel="noopener noreferrer" class="underline font-mono">${Number(sos.latitude).toFixed(4)}, ${Number(sos.longitude).toFixed(4)}</a>
                    </span>
                </div>
                <button type="button" class="sos-alert-btn is-ghost" data-sos-locate="${esc(sos.id)}" aria-label="Ver en el mapa"><i class="fas fa-location-crosshairs"></i></button>
                <button type="button" class="sos-alert-btn" data-sos-ack="${esc(sos.id)}"></button>
            </div>`;
    }

    function refreshCards() {
        const byId = new Map([...cards.querySelectorAll('[data-sos-id]')].map(card => [card.dataset.sosId, card]));
        list.forEach(sos => {
            const card = byId.get(String(sos.id));
            if (!card) return;
            if (!fresh.has(sos.id)) card.removeAttribute('role');
            const since = ago(sos.triggeredAt);
            const agoEl = card.querySelector('[data-sos-ago]');
            if (agoEl.textContent !== since) agoEl.textContent = since;
            const button = card.querySelector('[data-sos-ack]');
            const isBusy = busy.has(sos.id);
            if (button.disabled !== isBusy || !button.firstChild) {
                button.disabled = isBusy;
                button.innerHTML = isBusy ? '<i class="fas fa-circle-notch fa-spin"></i>' : 'Atender';
            }
        });
    }

    function renderBanner() {
        const key = down ? down + '|' + (lastOkAt || '') : '';
        if ((banner ? banner.dataset.key : '') === key) return;
        if (banner) banner.remove();
        banner = null;
        if (!down) return;
        const text = DOWN_TEXT[down];
        banner = document.createElement('div');
        banner.className = 'sos-monitor-down';
        banner.setAttribute('role', 'alert');
        banner.dataset.key = key;
        banner.dataset.sosMonitorDown = down;
        banner.innerHTML = `
            <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
            <div class="min-w-0">
                <b>${esc(text.title)}</b>
                <span>${esc(text.body)}</span>
                <small>${lastOkAt ? 'Lista desactualizada · última consulta correcta: ' + esc(clock(lastOkAt)) : 'Aún no se ha podido consultar la torre.'}</small>
            </div>`;
        host.insertBefore(banner, cards);
    }

    function render() {
        if (!ensureHost()) return;
        renderBanner();
        const key = list.map(sos => sos.id).join(',');
        if (key !== renderedKey) {
            renderedKey = key;
            cards.innerHTML = list.map(cardHtml).join('');
        }
        refreshCards();
        host.hidden = list.length === 0 && !banner;
    }

    function announce(newOnes) {
        window.Native.haptic('sos');
        const first = newOnes[0];
        window.ui.toast(newOnes.length > 1 ? newOnes.length + ' SOS nuevos' : 'SOS · ' + who(first), 'error', {
            description: newOnes.length > 1 ? 'Varios conductores piden ayuda.'
                : (first.vehiclePlate ? first.vehiclePlate + ' · ' : '') + 'pide ayuda ' + ago(first.triggeredAt) + '.',
            action: { label: 'Ver en mapa', onClick: () => focusOnMap(first.id) }
        });
        if (window.voiceEngine) window.voiceEngine.speak('Atención: ' + who(first) + ' activó el SOS.', true);
    }

    function announceDown() {
        try {
            window.Native.haptic('warning');
            if (window.voiceEngine) window.voiceEngine.speak('Monitoreo SOS caído.');
        } catch (error) {
        }
    }

    function failureCause(error) {
        const status = error && Number.isFinite(error.status) ? error.status : 0;
        return status === 401 || status === 403 ? 'auth' : 'network';
    }

    async function poll() {
        let next;
        try {
            next = await window.TruckCarService.loadActiveSos();
        } catch (error) {
            if (!timer) return;
            failures++;
            fresh = new Set();
            const cause = failureCause(error);
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (cause === 'auth' || offline || failures >= 2) {
                if (!down) announceDown();
                down = cause;
            }
            render();
            return;
        }
        if (!timer) return;
        list = next;
        failures = 0;
        down = null;
        lastOkAt = Date.now();
        const newOnes = list.filter(sos => !known.has(sos.id));
        list.forEach(sos => known.add(sos.id));
        fresh = new Set(newOnes.map(sos => sos.id));
        if (newOnes.length) announce(newOnes);
        render();
    }

    async function acknowledge(sosId) {
        if (busy.has(sosId)) return;
        busy.add(sosId);
        render();
        try {
            await window.TruckCarService.acknowledgeSos(sosId);
            list = list.filter(sos => sos.id !== sosId);
            fresh = new Set();
            window.ui.toast('SOS atendido', 'success', { description: 'Queda registrado a su nombre.' });
        } catch (error) {
            window.ui.failure('No se pudo marcar el SOS como atendido', error, 'atender el SOS');
        } finally {
            busy.delete(sosId);
            render();
        }
    }

    function focusOnMap(sosId) {
        const sos = list.find(s => s.id === sosId);
        if (!sos) return;
        const state = window.store.state;
        if (state.coordinatorTab !== 'fleet') window.store.setState({ coordinatorTab: 'fleet' });
        setTimeout(() => {
            if (window.mapCtrl && window.mapCtrl.map) window.mapCtrl.map.setView([sos.latitude, sos.longitude], 15);
        }, 60);
    }

    function start() {
        if (timer) return;
        timer = setInterval(poll, POLL_MS);
        poll();
    }

    function stop() {
        clearInterval(timer);
        timer = null;
        list = [];
        known.clear();
        busy.clear();
        fresh = new Set();
        failures = 0;
        down = null;
        lastOkAt = null;
        renderedKey = null;
        if (banner) banner.remove();
        banner = null;
        if (host) { host.hidden = true; cards.innerHTML = ''; }
    }

    function sync(state) {
        const tower = state.isAuthenticated && state.activeRole === 'coordinator' && TOWER.includes(state.sessionRole);
        if (tower) start();
        else if (timer) stop();
    }

    return { sync, stop, poll, acknowledge };
})();
