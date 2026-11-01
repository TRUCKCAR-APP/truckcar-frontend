/**
 * SOS en la torre de control (COORDINADOR/ADMIN): consulta GET /api/v1/alerts/sos cada 5 s y muestra una franja roja
 * fija con cada SOS sin atender. Un SOS nuevo vibra, habla y lanza un toast; "Atender" lo marca como atendido
 * (PATCH /alerts/sos/{id}/acknowledge) y desaparece para el resto de coordinadores en su siguiente consulta.
 *
 * Como el botón SOS del conductor, la franja vive fuera de #app-mount: el panel se re-renderiza en cada setState.
 */
window.SosMonitor = (function () {
    const esc = (value) => window.ui.escape(value);
    const POLL_MS = 5000;
    const TOWER = ['COORDINADOR', 'ADMIN'];

    let timer = null;
    let host = null;
    let list = [];
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

    function ensureHost() {
        if (host) return host;
        const frame = document.getElementById('phone-mockup-frame');
        if (!frame) return null;
        host = document.createElement('div');
        host.className = 'sos-alerts';
        host.setAttribute('aria-live', 'assertive');
        host.addEventListener('click', (event) => {
            const ack = event.target.closest('[data-sos-ack]');
            const locate = event.target.closest('[data-sos-locate]');
            if (ack) acknowledge(Number(ack.dataset.sosAck));
            if (locate) focusOnMap(Number(locate.dataset.sosLocate));
        });
        frame.appendChild(host);
        return host;
    }

    function render() {
        if (!ensureHost()) return;
        host.hidden = list.length === 0;
        host.innerHTML = list.map(sos => `
            <div class="sos-alert" role="alert" data-sos-id="${esc(sos.id)}">
                <span class="sos-alert-icon" aria-hidden="true"><i class="fas fa-life-ring"></i></span>
                <div class="min-w-0 flex-1">
                    <b class="block text-[13px] leading-tight truncate">SOS · ${esc(who(sos))}${sos.vehiclePlate ? ' · <span class="font-mono">' + esc(sos.vehiclePlate) + '</span>' : ''}</b>
                    <span class="block text-[11.5px] opacity-90 truncate">
                        ${sos.loadId ? 'CARGA-' + esc(sos.loadId) + ' · ' : ''}${esc(ago(sos.triggeredAt))} ·
                        <a href="${esc(mapsUrl(sos))}" target="_blank" rel="noopener noreferrer" class="underline font-mono">${Number(sos.latitude).toFixed(4)}, ${Number(sos.longitude).toFixed(4)}</a>
                    </span>
                </div>
                <button type="button" class="sos-alert-btn is-ghost" data-sos-locate="${esc(sos.id)}" aria-label="Ver en el mapa"><i class="fas fa-location-crosshairs"></i></button>
                <button type="button" class="sos-alert-btn" data-sos-ack="${esc(sos.id)}" ${busy.has(sos.id) ? 'disabled' : ''}>
                    ${busy.has(sos.id) ? '<i class="fas fa-circle-notch fa-spin"></i>' : 'Atender'}
                </button>
            </div>`).join('');
    }

    function announce(fresh) {
        window.Native.haptic('sos');
        const first = fresh[0];
        window.ui.toast(fresh.length > 1 ? fresh.length + ' SOS nuevos' : 'SOS · ' + who(first), 'error', {
            description: fresh.length > 1 ? 'Varios conductores piden ayuda.'
                : (first.vehiclePlate ? first.vehiclePlate + ' · ' : '') + 'pide ayuda ' + ago(first.triggeredAt) + '.',
            action: { label: 'Ver en mapa', onClick: () => focusOnMap(first.id) }
        });
        if (window.voiceEngine) window.voiceEngine.speak('Atención: ' + who(first) + ' activó el SOS.', true);
    }

    async function poll() {
        try {
            list = await window.TruckCarService.loadActiveSos();
        } catch (error) {
            // Se conserva la última lista: un SOS no debe desaparecer de la pantalla por un fallo de red.
            return;
        }
        if (!timer) return;
        const fresh = list.filter(sos => !known.has(sos.id));
        list.forEach(sos => known.add(sos.id));
        if (fresh.length) announce(fresh);
        render();
    }

    async function acknowledge(sosId) {
        if (busy.has(sosId)) return;
        busy.add(sosId);
        render();
        try {
            await window.TruckCarService.acknowledgeSos(sosId);
            list = list.filter(sos => sos.id !== sosId);
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
        if (host) { host.hidden = true; host.innerHTML = ''; }
    }

    /** Activo solo para la torre de control autenticada (un GENERADOR o CONDUCTOR recibiría 403). */
    function sync(state) {
        const tower = state.isAuthenticated && state.activeRole === 'coordinator' && TOWER.includes(state.sessionRole);
        if (tower) start();
        else if (timer) stop();
    }

    return { sync, stop, poll, acknowledge };
})();
