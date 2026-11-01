// Prototipo estático (dirección B): cabecera, barra inferior, SOS y hoja de reportar compartidos.
// Estados para capturas: ?sos=hold|confirmado|sin-senal, ?hoja=reportar, ?demo=1 (herramientas de prueba).
(function () {
    const params = new URLSearchParams(location.search);
    // Dirección elegida: B (ámbar). ?dir=a muestra la alternativa descartada.
    const dir = params.get('dir') === 'a' ? 'a' : 'b';
    document.documentElement.dataset.dir = dir;

    const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="icons.svg#${name}"></use></svg>`;
    const screen = document.body.dataset.screen;
    const tabs = [
        ['vehiculo', 'Vehículo', 'truck'],
        ['carga', 'Carga', 'package'],
        ['rutas', 'Rutas', 'path'],
        ['navegar', 'Navegar', 'navigation-arrow'],
        ['alertas', 'Alertas', 'warning'],
        ['offline', 'Offline', 'cloud-arrow-down']
    ];

    const header = document.querySelector('[data-header]');
    if (header) header.outerHTML = `
        <header class="header">
            <span class="wordmark">TruckCar</span>
            ${document.body.dataset.net === 'offline'
                ? `<span class="net warn-line">${icon('warning-fill', 'icon-sm')}Sin señal</span>`
                : '<span class="net"><span class="dot ok"></span>En línea</span>'}
            <span class="spacer"></span>
            <button type="button" class="sos" data-sos aria-label="SOS de emergencia: mantenga presionado 1,5 segundos"><span class="sos-face">${icon('siren')}SOS</span></button>
            <button type="button" class="icon-btn" aria-label="Cerrar sesión">${icon('sign-out')}</button>
        </header>`;

    const tabbar = document.querySelector('[data-tabbar]');
    if (tabbar) tabbar.outerHTML = `
        <nav class="tabbar" aria-label="Secciones">
            ${tabs.map(([id, label, glyph]) => `
                <a class="tab" href="${id}.html" ${id === screen ? 'aria-current="page"' : ''}>
                    ${icon(id === screen ? glyph + '-fill' : glyph)}<span>${label}</span>
                </a>`).join('')}
        </nav>`;

    // ── SOS ─────────────────────────────────────────────────────────────────────────────────────────────────
    // "Torre de control avisada" solo con el acuse del servidor. Sin acuse o sin señal, el aviso queda en el teléfono.
    const confirmed = params.get('sos') !== 'sin-senal';
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sos-modal" data-sos-modal role="alertdialog" aria-labelledby="sos-title" hidden>
            ${icon('siren')}
            <h2 id="sos-title">SOS activado</h2>
            ${confirmed
                ? `<p>Mantenga la calma. Si hay heridos o peligro inmediato, llame a la línea de emergencias.</p>
                   <span class="sent">${icon('check-circle-fill', 'icon-sm')}Torre de control avisada · SOS #42, 9:14 p. m.</span>`
                : `<span class="sent pending">${icon('warning-fill', 'icon-sm')}<span>Sin señal: el aviso se enviará al recuperar la señal. <b>Llame al 123 ahora.</b></span></span>`}
            <dl>
                <dt>Posición</dt><dd>4,35988, −74,43699 ±9 m</dd>
                <dt>Lectura GPS</dt><dd>hace 40 s</dd>
                <dt>Vehículo</dt><dd>TDK 410</dd>
                <dt>Carga</dt><dd>CARGA-88</dd>
            </dl>
            <span class="spacer"></span>
            <button type="button" class="sos-call">${icon('phone')}Llamar al 123</button>
            <button type="button" class="sos-close" data-close>Cerrar</button>
        </div>`);

    const sos = document.querySelector('[data-sos]');
    const modal = document.querySelector('[data-sos-modal]');
    if (sos) {
        let timer = null;
        const cancel = () => { clearTimeout(timer); timer = null; sos.classList.remove('is-holding'); };
        sos.addEventListener('pointerdown', (event) => {
            sos.setPointerCapture(event.pointerId);
            sos.classList.add('is-holding');
            timer = setTimeout(() => { cancel(); modal.hidden = false; }, 1500);
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => sos.addEventListener(type, () => { if (timer) cancel(); }));
        if (params.get('sos') === 'hold') sos.style.setProperty('--hold', '0.6');
    }
    modal.querySelector('[data-close]').addEventListener('click', () => { modal.hidden = true; });
    if (['confirmado', 'sin-senal', 'active'].includes(params.get('sos'))) modal.hidden = false;

    // ── Hoja de reportar en la vía ───────────────────────────────────────────────────────────────────────────
    const reports = [
        ['mountains', 'Derrumbe'], ['car-profile', 'Accidente'], ['traffic-cone', 'Obra en vía'],
        ['police-car', 'Retén'], ['scales', 'Báscula'], ['arrows-vertical', 'Gálibo bajo'], ['bed', 'Parador seguro']
    ];
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sheet-backdrop" data-report-sheet hidden>
            <section class="report-sheet" role="dialog" aria-labelledby="report-title">
                <div class="sheet-handle" aria-hidden="true"></div>
                <div class="sheet-head">
                    <div>
                        <h2 id="report-title">Reportar en la vía</h2>
                        <p class="secondary">Un toque publica el reporte con su posición actual.</p>
                    </div>
                    <button type="button" class="icon-btn" data-close-sheet aria-label="Cerrar">${icon('x')}</button>
                </div>
                <div class="report-grid">
                    ${reports.map(([glyph, label]) => `<button type="button" class="report-tile">${icon(glyph)}<span>${label}</span></button>`).join('')}
                </div>
                <p class="secondary sheet-note">Sin señal, el reporte se guarda en el teléfono y se envía al reconectar.</p>
            </section>
        </div>`);
    const sheet = document.querySelector('[data-report-sheet]');
    document.querySelectorAll('[data-open-report]').forEach((b) => b.addEventListener('click', () => { sheet.hidden = false; }));
    sheet.querySelector('[data-close-sheet]').addEventListener('click', () => { sheet.hidden = true; });
    if (params.get('hoja') === 'reportar') sheet.hidden = false;

    // Herramientas de prueba: solo con ?demo=1, nunca en la experiencia normal.
    document.querySelectorAll('[data-demo-only]').forEach((el) => { el.hidden = params.get('demo') !== '1'; });
})();
