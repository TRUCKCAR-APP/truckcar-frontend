/**
 * Prueba de entrega (POD): formulario del conductor (firma en lienzo + foto) y visor del recibo firmado.
 * Los modales se montan directamente en <body>, fuera de #app-mount: las vistas se re-renderizan completas en
 * cada setState y eso borraría la firma que el receptor está dibujando.
 */
window.PodUI = (function () {
    const PHOTO_MAX_SIDE = 1280;
    const PHOTO_QUALITY = 0.72;

    const esc = (value) => window.ui.escape(value);

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        return isNaN(date) ? String(value) : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function mountOverlay(id, innerHtml) {
        closeOverlay(id);
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'fixed inset-0 z-[2000] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6';
        overlay.innerHTML = innerHtml;
        document.body.appendChild(overlay);
        return overlay;
    }

    function closeOverlay(id) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
    }

    // ------------------------------------------------------------------ firma
    /** Lienzo de firma con Pointer Events (mouse, lápiz y dedo). Fondo blanco para que se lea en el recibo. */
    function createSignaturePad(canvas) {
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let hasInk = false;
        let last = null;

        function resize() {
            const ratio = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            clear();
        }

        function clear() {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            hasInk = false;
        }

        function point(event) {
            const rect = canvas.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }

        canvas.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            canvas.setPointerCapture(event.pointerId);
            drawing = true;
            last = point(event);
            ctx.beginPath();
            ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
            hasInk = true;
        });
        canvas.addEventListener('pointermove', (event) => {
            if (!drawing) return;
            const current = point(event);
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(current.x, current.y);
            ctx.stroke();
            last = current;
        });
        const stop = () => { drawing = false; last = null; };
        canvas.addEventListener('pointerup', stop);
        canvas.addEventListener('pointercancel', stop);
        canvas.addEventListener('pointerleave', stop);

        resize();
        return {
            clear,
            isEmpty: () => !hasInk,
            toDataUrl: () => canvas.toDataURL('image/png')
        };
    }

    // ------------------------------------------------------------------ foto
    /** Reduce la foto (cámara o archivo) a JPEG de máx. 1280 px para no exceder el límite del backend. */
    function compressPhoto(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject(new Error('El archivo seleccionado no es una imagen'));
                return;
            }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('No se pudo leer la imagen'));
            };
            img.src = url;
        });
    }

    /** Evidencia simulada (sin cámara): imagen con los datos de la carga, útil en escritorio y demos. */
    function simulatedPhoto(load) {
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 960, 600);
        gradient.addColorStop(0, '#1e293b');
        gradient.addColorStop(1, '#0f766e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 960, 600);
        ctx.fillStyle = '#b45309';
        for (let i = 0; i < 6; i++) {
            ctx.fillRect(120 + (i % 3) * 250, 210 + Math.floor(i / 3) * 150, 210, 120);
        }
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText('Evidencia de entrega (simulada)', 40, 70);
        ctx.font = '24px sans-serif';
        ctx.fillText(load.id + ' · ' + (load.cargoType || ''), 40, 115);
        ctx.fillText((load.destination && load.destination.name ? load.destination.name : '') + ' · ' + new Date().toLocaleString('es-CO'), 40, 150);
        return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
    }

    // ------------------------------------------------------------------ formulario de entrega
    /**
     * Abre el formulario de entrega. onSubmit(pod) se llama al confirmar; si falla, el formulario sigue abierto
     * con el error para no perder la firma. Devuelve una promesa: true si se registró, false si se canceló.
     */
    function openDeliveryForm(load, onSubmit) {
        return new Promise((resolve) => {
            const overlay = mountOverlay('pod-delivery-modal', `
                <form id="pod-form" class="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg max-h-full overflow-y-auto shadow-2xl p-5 space-y-4 text-slate-200" novalidate>
                    <div class="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                        <div>
                            <h3 class="font-extrabold text-base text-white flex items-center gap-2"><i class="fas fa-file-signature text-emerald-400"></i> Registrar entrega</h3>
                            <p class="text-xs text-slate-400 mt-0.5">${esc(load.id)} · ${esc(load.destination && load.destination.name)}</p>
                        </div>
                        <button type="button" data-action="cancel" class="text-slate-400 hover:text-white text-lg" aria-label="Cerrar"><i class="fas fa-times"></i></button>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="text-xs space-y-1 sm:col-span-2">
                            <span class="font-bold text-slate-300">Nombre de quien recibe <span class="text-rose-400">*</span></span>
                            <input name="receiverName" maxlength="150" required autocomplete="off" class="login-input w-full text-sm" placeholder="Ej. Jefe de bodega">
                        </label>
                        <label class="text-xs space-y-1">
                            <span class="font-bold text-slate-300">Documento</span>
                            <input name="receiverDocument" maxlength="40" autocomplete="off" class="login-input w-full text-sm" placeholder="CC 1020304050">
                        </label>
                        <label class="text-xs space-y-1">
                            <span class="font-bold text-slate-300">Observaciones</span>
                            <input name="notes" maxlength="500" autocomplete="off" class="login-input w-full text-sm" placeholder="Sin novedades">
                        </label>
                    </div>

                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between text-xs">
                            <span class="font-bold text-slate-300">Firma del receptor <span class="text-rose-400">*</span></span>
                            <button type="button" data-action="clear-signature" class="text-slate-400 hover:text-amber-300"><i class="fas fa-eraser"></i> Borrar</button>
                        </div>
                        <canvas id="pod-signature" class="w-full h-40 rounded-xl border-2 border-dashed border-slate-600 bg-white cursor-crosshair" style="touch-action: none"></canvas>
                        <p class="text-[10px] text-slate-500">Firme con el dedo, lápiz o mouse dentro del recuadro.</p>
                    </div>

                    <div class="space-y-2">
                        <span class="text-xs font-bold text-slate-300">Foto de la carga entregada</span>
                        <div class="flex flex-wrap gap-2">
                            <label class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold cursor-pointer">
                                <i class="fas fa-camera"></i> Tomar o adjuntar foto
                                <input type="file" name="photoFile" accept="image/*" capture="environment" class="hidden">
                            </label>
                            <button type="button" data-action="simulate-photo" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold"><i class="fas fa-wand-magic-sparkles"></i> Simular foto</button>
                            <button type="button" data-action="remove-photo" class="px-3 py-1.5 text-xs text-slate-400 hover:text-rose-300 hidden"><i class="fas fa-trash"></i> Quitar</button>
                        </div>
                        <input name="photoUrl" type="url" maxlength="2048" autocomplete="off" class="login-input w-full text-xs" placeholder="…o pegue la URL https de la foto">
                        <img id="pod-photo-preview" alt="Vista previa de la foto de entrega" class="hidden w-full max-h-48 object-cover rounded-xl border border-slate-700">
                    </div>

                    <p id="pod-error" class="hidden text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5"></p>

                    <div class="flex justify-end gap-2 pt-1">
                        <button type="button" data-action="cancel" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold">
                            <i class="fas fa-check"></i> Confirmar entrega
                        </button>
                    </div>
                </form>
            `);

            const form = overlay.querySelector('#pod-form');
            const pad = createSignaturePad(overlay.querySelector('#pod-signature'));
            const preview = overlay.querySelector('#pod-photo-preview');
            const removeBtn = overlay.querySelector('[data-action="remove-photo"]');
            const errorBox = overlay.querySelector('#pod-error');
            const submitBtn = form.querySelector('button[type="submit"]');
            let photoDataUrl = null;

            const showError = (message) => {
                errorBox.textContent = message;
                errorBox.classList.toggle('hidden', !message);
            };
            const setPhoto = (dataUrl) => {
                photoDataUrl = dataUrl;
                preview.src = dataUrl || '';
                preview.classList.toggle('hidden', !dataUrl);
                removeBtn.classList.toggle('hidden', !dataUrl);
            };
            const finish = (result) => {
                document.removeEventListener('keydown', onKey);
                closeOverlay('pod-delivery-modal');
                resolve(result);
            };
            const onKey = (event) => { if (event.key === 'Escape') finish(false); };
            document.addEventListener('keydown', onKey);

            overlay.querySelectorAll('[data-action="cancel"]').forEach(btn => btn.addEventListener('click', () => finish(false)));
            overlay.querySelector('[data-action="clear-signature"]').addEventListener('click', () => pad.clear());
            overlay.querySelector('[data-action="simulate-photo"]').addEventListener('click', () => setPhoto(simulatedPhoto(load)));
            removeBtn.addEventListener('click', () => { setPhoto(null); form.photoFile.value = ''; });
            form.photoFile.addEventListener('change', async () => {
                const file = form.photoFile.files[0];
                if (!file) return;
                try {
                    setPhoto(await compressPhoto(file));
                    showError('');
                } catch (error) {
                    showError(error.message);
                }
            });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const receiverName = form.receiverName.value.trim();
                const photoUrl = photoDataUrl || form.photoUrl.value.trim() || null;
                if (!receiverName) return showError('Indique el nombre de quien recibe la carga.');
                if (pad.isEmpty()) return showError('La entrega requiere la firma de quien recibe.');
                if (photoUrl && !photoDataUrl && !/^https?:\/\/\S+$/.test(photoUrl)) {
                    return showError('La URL de la foto debe empezar por http:// o https://');
                }
                showError('');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando…';
                try {
                    await onSubmit({
                        receiverName,
                        receiverDocument: form.receiverDocument.value.trim() || null,
                        notes: form.notes.value.trim() || null,
                        signatureDataUrl: pad.toDataUrl(),
                        photoUrl
                    });
                    finish(true);
                } catch (error) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirmar entrega';
                    showError('No se pudo registrar la entrega: ' + window.ui.errorMessage(error));
                }
            });
            form.receiverName.focus();
        });
    }

    // ------------------------------------------------------------------ recibo
    /** Tarjeta del recibo firmado. pod usa los campos de GET /loads/{id}/proof-of-delivery. */
    function receiptHtml(pod, load) {
        const route = load && load.origin ? esc(load.origin.city) + ' → ' + esc(load.destination.city) : '';
        return `
            <div class="bg-white text-slate-900 rounded-2xl overflow-hidden shadow-xl">
                <div class="px-4 py-3 bg-emerald-600 text-white flex items-center justify-between gap-2">
                    <div class="font-extrabold text-sm flex items-center gap-2"><i class="fas fa-circle-check"></i> Recibo de entrega firmado</div>
                    <span class="font-mono text-[11px] bg-white/20 rounded px-2 py-0.5">CARGA-${esc(pod.loadId)}</span>
                </div>
                <div class="p-4 space-y-3 text-xs">
                    ${route ? `<div class="flex justify-between gap-2"><span class="text-slate-500">Trayecto</span><span class="font-bold text-right">${route}</span></div>` : ''}
                    <div class="grid grid-cols-2 gap-x-3 gap-y-2">
                        <div><span class="block text-slate-500">Recibió</span><b>${esc(pod.receiverName || '—')}</b></div>
                        <div><span class="block text-slate-500">Documento</span><b class="font-mono">${esc(pod.receiverDocument || '—')}</b></div>
                        <div><span class="block text-slate-500">Conductor</span><b>${esc(pod.driverName || '—')}</b>${pod.vehiclePlate ? ` <span class="font-mono text-slate-500">(${esc(pod.vehiclePlate)})</span>` : ''}</div>
                        <div><span class="block text-slate-500">Entregada</span><b>${esc(formatDate(pod.deliveredAt))}</b></div>
                        ${pod.tripStartedAt ? `<div class="col-span-2"><span class="text-slate-500">Inicio del viaje:</span> ${esc(formatDate(pod.tripStartedAt))}</div>` : ''}
                    </div>
                    <div class="p-2.5 bg-slate-100 rounded-xl"><span class="block text-slate-500 mb-0.5">Observaciones</span>${esc(pod.notes || 'Sin observaciones')}</div>
                    <div>
                        <span class="block text-slate-500 mb-1">Firma</span>
                        ${pod.signatureDataUrl
                            ? `<img src="${esc(pod.signatureDataUrl)}" alt="Firma de ${esc(pod.receiverName || 'quien recibe')}" class="w-full max-h-36 object-contain border border-slate-200 rounded-xl bg-white">`
                            : '<div class="p-3 border border-dashed border-slate-300 rounded-xl text-center text-slate-400">Sin firma registrada</div>'}
                    </div>
                    <div>
                        <span class="block text-slate-500 mb-1">Foto de la evidencia</span>
                        ${pod.photoUrl
                            ? `<a href="${esc(pod.photoUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(pod.photoUrl)}" alt="Foto de la carga entregada" class="w-full max-h-64 object-cover border border-slate-200 rounded-xl"></a>`
                            : '<div class="p-3 border border-dashed border-slate-300 rounded-xl text-center text-slate-400">Sin foto adjunta</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    /** Visor del POD (torre de control y conductor): pide la prueba completa al backend. */
    async function showProofOfDelivery(loadId, load) {
        const overlay = mountOverlay('pod-viewer-modal', `
            <div class="w-full max-w-md max-h-full overflow-y-auto space-y-3">
                <div id="pod-viewer-body" class="bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center text-slate-300 text-xs">
                    <i class="fas fa-spinner fa-spin text-lg mb-2 block"></i> Consultando la prueba de entrega…
                </div>
                <div class="flex justify-end">
                    <button type="button" data-action="close" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold">Cerrar</button>
                </div>
            </div>
        `);
        const close = () => { document.removeEventListener('keydown', onKey); closeOverlay('pod-viewer-modal'); };
        const onKey = (event) => { if (event.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
        overlay.querySelector('[data-action="close"]').addEventListener('click', close);

        const body = overlay.querySelector('#pod-viewer-body');
        try {
            const pod = await window.TruckCarService.getProofOfDelivery(loadId);
            if (!document.body.contains(overlay)) return;
            body.outerHTML = receiptHtml(pod, load);
        } catch (error) {
            body.innerHTML = '<i class="fas fa-triangle-exclamation text-rose-400 text-lg mb-2 block"></i>'
                + esc('No se pudo obtener la prueba de entrega: ' + window.ui.errorMessage(error));
        }
    }

    return { openDeliveryForm, showProofOfDelivery, receiptHtml, formatDate };
})();
