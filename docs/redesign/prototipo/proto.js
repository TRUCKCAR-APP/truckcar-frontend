// Prototipo estático: cabecera, barra inferior y SOS compartidos. ?dir=b activa la dirección B.
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
    const link = (page) => (['vehiculo', 'carga', 'rutas', 'navegar', 'alertas', 'offline'].includes(page) ? page + '.html?dir=' + dir : '#');

    document.querySelector('[data-header]').outerHTML = `
        <header class="header">
            <span class="wordmark">TruckCar</span>
            ${document.body.dataset.net === 'offline'
                ? `<span class="net warn-line">${icon('warning-fill', 'icon-sm')}Sin señal</span>`
                : '<span class="net"><span class="dot ok"></span>En línea</span>'}
            <span class="spacer"></span>
            <button type="button" class="sos" data-sos aria-label="SOS de emergencia: mantenga presionado 1,5 segundos"><span class="sos-face">${icon('siren')}SOS</span></button>
            <button type="button" class="icon-btn" aria-label="Cerrar sesión">${icon('sign-out')}</button>
        </header>`;

    document.querySelector('[data-tabbar]').outerHTML = `
        <nav class="tabbar" aria-label="Secciones">
            ${tabs.map(([id, label, glyph]) => `
                <a class="tab" href="${link(id)}" ${id === screen ? 'aria-current="page"' : ''} style="text-decoration:none">
                    ${icon(id === screen ? glyph + '-fill' : glyph)}<span>${label}</span>
                </a>`).join('')}
        </nav>`;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="sos-modal" data-sos-modal role="alertdialog" aria-labelledby="sos-title" hidden>
            ${icon('siren')}
            <h2 id="sos-title">SOS activado</h2>
            <p>Mantenga la calma. Si hay heridos o peligro inmediato, llame a la línea de emergencias.</p>
            <span class="sent"><span class="dot"></span>Torre de control avisada · SOS #42, 9:14 p. m.</span>
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

    // SOS: mantener 1,5 s llena el botón de rojo; al completarse, el modal en rojo pleno.
    const sos = document.querySelector('[data-sos]');
    const modal = document.querySelector('[data-sos-modal]');
    let timer = null;
    const cancel = () => { clearTimeout(timer); sos.classList.remove('is-holding'); };
    sos.addEventListener('pointerdown', (event) => {
        sos.setPointerCapture(event.pointerId);
        sos.classList.add('is-holding');
        timer = setTimeout(() => { cancel(); if (modal) modal.hidden = false; }, 1500);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => sos.addEventListener(type, () => { if (timer) cancel(); }));
    if (modal) modal.querySelector('[data-close]').addEventListener('click', () => { modal.hidden = true; });

    // Captura de estados: ?sos=hold muestra el botón a medio llenar, ?sos=active el modal.
    if (params.get('sos') === 'hold') { sos.style.setProperty('--hold', '0.6'); sos.style.color = '#fff'; }
    if (params.get('sos') === 'active' && modal) modal.hidden = false;
})();
