// Navegación libre del conductor: buscar un destino por nombre (HERE, a través de Route-AI-agent) y elegir entre los
// resultados. También la usa el Copiloto de voz para mostrar en pantalla las opciones que lee en voz alta.
window.DestinationSearch = (function () {
    const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;

    function distanceText(meters) {
        if (!Number.isFinite(meters)) return '';
        return meters < 1000 ? Math.max(10, Math.round(meters / 10) * 10) + ' m'
            : (meters / 1000).toLocaleString('es-CO', { maximumFractionDigits: meters < 10000 ? 1 : 0 }) + ' km';
    }

    /** Lista de resultados con su número (el mismo que dice el Copiloto: «la segunda»). */
    function resultsHtml(places) {
        const esc = window.ui.escape;
        if (!places.length) return '<p class="sheet-note" data-dest-empty>No se encontraron lugares con ese nombre. Pruebe con otra palabra o agregue la ciudad.</p>';
        return '<ol class="dest-results" data-dest-results>' + places.map((p, i) => `
            <li>
                <button type="button" class="dest-result" data-dest-index="${i}">
                    <span class="dest-number" aria-hidden="true">${i + 1}</span>
                    <span class="dest-text">
                        <span class="dest-title">${esc(p.title)}</span>
                        <span class="dest-sub">${esc([p.category, p.address, distanceText(p.distanceMeters)].filter(Boolean).join(' · '))}</span>
                    </span>
                    ${icon('caret-right')}
                </button>
            </li>`).join('') + '</ol>';
    }

    let current = null;

    /**
     * Abre la hoja «¿A dónde va?». Con places ya buscados (por voz) muestra directamente las opciones.
     * Al elegir una, window.app.goToPlace la lleva a la guía.
     */
    function open({ query = '', places = null } = {}) {
        const esc = window.ui.escape;
        if (current) current.close(null);
        const body = `
            <form class="dest-form" data-dest-form novalidate>
                <label class="field">
                    <span class="field-label">Destino</span>
                    <span class="dest-input">
                        <input name="q" type="search" required minlength="2" maxlength="120" value="${esc(query)}" enterkeyhint="search"
                               autocomplete="off" placeholder="Empresa, dirección, ciudad o lugar" class="field-input" data-dest-query>
                        <button type="submit" class="header-icon-btn" aria-label="Buscar">${icon('magnifying-glass')}</button>
                    </span>
                </label>
            </form>
            <div data-dest-area aria-live="polite">${places ? resultsHtml(places) : '<p class="sheet-note">La ruta se calcula para su camión desde su posición actual.</p>'}</div>`;
        const closed = window.Sheet.open({
            title: '¿A dónde va?',
            subtitle: 'Busque cualquier destino, aunque no sea el de una carga.',
            body,
            onMount(sheet, close) {
                let found = places || [];
                current = { sheet, close, setPlaces };
                const area = sheet.querySelector('[data-dest-area]');
                const input = sheet.querySelector('[data-dest-query]');
                function setPlaces(list) {
                    found = list;
                    area.innerHTML = resultsHtml(list);
                }
                sheet.querySelector('[data-dest-form]').addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const q = input.value.trim();
                    if (q.length < 2) { area.innerHTML = '<p class="sheet-note">Escriba al menos dos letras.</p>'; return; }
                    area.innerHTML = '<p class="sheet-note"><span class="spinner" aria-hidden="true"></span> Buscando…</p>';
                    try {
                        setPlaces(await window.app.searchPlaces(q));
                    } catch (error) {
                        area.innerHTML = `<p class="sheet-note" role="alert">${esc(window.ui.errorMessage(error))}</p>`;
                    }
                });
                area.addEventListener('click', (event) => {
                    const button = event.target.closest('[data-dest-index]');
                    if (!button) return;
                    const place = found[Number(button.dataset.destIndex)];
                    if (!place) return;
                    close(null);
                    window.app.goToPlace(place);
                });
                if (!places) setTimeout(() => input.focus({ preventScroll: true }), 50);
            }
        });
        closed.then(() => { current = null; });
        return closed;
    }

    /** El Copiloto muestra en pantalla las opciones que está leyendo. */
    function showResults(places, query) {
        if (current) current.setPlaces(places);
        else open({ query, places });
    }

    function close() {
        if (current) current.close(null);
    }

    return { open, showResults, close, resultsHtml, distanceText };
})();
