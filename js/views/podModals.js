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
        closeOverlay(id, false);
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'sheet-backdrop';
        overlay.innerHTML = innerHtml;
        const panel = overlay.firstElementChild;
        panel.classList.add('sheet');
        panel.insertAdjacentHTML('afterbegin', '<div class="sheet-handle" aria-hidden="true"></div>');
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));
        return overlay;
    }

    function closeOverlay(id, animated = true) {
        const existing = document.getElementById(id);
        if (!existing) return;
        if (!animated) {
            existing.remove();
            return;
        }
        existing.id = '';
        existing.classList.remove('is-open');
        setTimeout(() => existing.remove(), 430);
    }

    function createSignaturePad(canvas, onStroke) {
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
        const stop = () => {
            if (drawing && onStroke) onStroke();
            drawing = false;
            last = null;
        };
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

    function openDeliveryForm(load, onSubmit) {
        return new Promise((resolve) => {
            const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
            const overlay = mountOverlay('pod-delivery-modal', `
                <form id="pod-form" class="pod-form" novalidate aria-labelledby="pod-title">
                    <div class="pod-head">
                        <div class="min-w-0">
                            <h2 id="pod-title">Registrar entrega</h2>
                            <p class="secondary">${esc(load.id)} · ${esc(load.destination && load.destination.name)}</p>
                        </div>
                        <button type="button" data-action="cancel" class="header-icon-btn" aria-label="Cerrar sin registrar">${icon('x')}</button>
                    </div>

                    <div class="pod-fields">
                        <div id="pod-error" class="pod-error hidden" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span data-error-title>No se pudo registrar la entrega</span></div>
                            <p data-error-text></p>
                        </div>

                        <label class="field">
                            <span class="field-label">Nombre de quien recibe <span class="field-req">· obligatorio</span></span>
                            <input name="receiverName" maxlength="150" required autocomplete="off" class="field-input" placeholder="Ej. jefe de bodega">
                        </label>
                        <label class="field">
                            <span class="field-label">Documento</span>
                            <input name="receiverDocument" maxlength="40" autocomplete="off" class="field-input" placeholder="CC 1020304050">
                        </label>
                        <label class="field">
                            <span class="field-label">Observaciones</span>
                            <input name="notes" maxlength="500" autocomplete="off" class="field-input" placeholder="Sin novedades">
                        </label>

                        <div class="field">
                            <div class="field-row">
                                <span class="field-label">Firma de quien recibe <span class="field-req">· obligatoria</span></span>
                                <button type="button" data-action="clear-signature" class="field-link">${icon('eraser')}Borrar</button>
                            </div>
                            <canvas id="pod-signature" class="pod-signature" style="touch-action: none" aria-label="Lienzo de firma"></canvas>
                            <div class="field-row">
                                <span class="field-help">Firme con el dedo dentro del recuadro.</span>
                                <span data-hash="signature" class="pod-hash hidden" title=""></span>
                            </div>
                        </div>

                        <div class="field">
                            <span class="field-label">Foto de la carga entregada</span>
                            <div class="pod-photo-actions">
                                <label class="pod-photo-slot">
                                    ${icon('camera')}Tomar o adjuntar foto
                                    <input type="file" name="photoFile" accept="image/*" capture="environment" class="hidden">
                                </label>
                                <button type="button" data-action="simulate-photo" class="field-link demo-only">Simular foto</button>
                                <button type="button" data-action="remove-photo" class="field-link hidden">${icon('x')}Quitar</button>
                            </div>
                            <figure id="pod-photo-figure" class="pod-photo hidden">
                                <img id="pod-photo-preview" alt="Vista previa de la foto de entrega">
                                <figcaption><span data-hash="photo" class="pod-hash" title=""></span></figcaption>
                            </figure>
                        </div>
                        <p class="field-help">La firma y la foto se envían cifradas. Sin señal se guardan en el teléfono y se envían al reconectar.</p>
                    </div>

                    <div class="pod-footer">
                        <button type="submit" class="btn-accent">${icon('check-circle')}<span>Confirmar entrega</span></button>
                    </div>
                </form>
            `);

            const form = overlay.querySelector('#pod-form');
            const preview = overlay.querySelector('#pod-photo-preview');
            const figure = overlay.querySelector('#pod-photo-figure');
            const showHash = async (kind, dataUrl) => {
                const chip = overlay.querySelector('[data-hash="' + kind + '"]');
                if (!dataUrl) {
                    chip.classList.add('hidden');
                    return;
                }
                const hash = await window.PodEvidence.sha256Hex(await window.PodEvidence.dataUrlToBlob(dataUrl));
                chip.textContent = 'Huella SHA-256 ' + hash.slice(0, 12) + '…';
                chip.title = 'SHA-256 ' + hash;
                chip.classList.remove('hidden');
            };
            let hashTimer = null;
            const pad = createSignaturePad(overlay.querySelector('#pod-signature'), () => {
                clearTimeout(hashTimer);
                hashTimer = setTimeout(() => showHash('signature', pad.toDataUrl()), 250);
            });
            const removeBtn = overlay.querySelector('[data-action="remove-photo"]');
            const errorBox = overlay.querySelector('#pod-error');
            const submitBtn = form.querySelector('button[type="submit"]');
            let photoDataUrl = null;

            const showError = (message, title = 'Falta un dato obligatorio') => {
                errorBox.querySelector('[data-error-title]').textContent = title;
                errorBox.querySelector('[data-error-text]').textContent = message;
                errorBox.classList.toggle('hidden', !message);
                if (message) errorBox.scrollIntoView({ block: 'nearest' });
            };
            const setPhoto = (dataUrl) => {
                photoDataUrl = dataUrl;
                preview.src = dataUrl || '';
                figure.classList.toggle('hidden', !dataUrl);
                removeBtn.classList.toggle('hidden', !dataUrl);
                showHash('photo', dataUrl);
            };
            const finish = (result) => {
                document.removeEventListener('keydown', onKey);
                closeOverlay('pod-delivery-modal');
                resolve(result);
            };
            const onKey = (event) => { if (event.key === 'Escape') finish(false); };
            document.addEventListener('keydown', onKey);

            overlay.querySelectorAll('[data-action="cancel"]').forEach(btn => btn.addEventListener('click', () => finish(false)));
            overlay.querySelector('[data-action="clear-signature"]').addEventListener('click', () => {
                pad.clear();
                showHash('signature', null);
            });
            overlay.querySelector('[data-action="simulate-photo"]').addEventListener('click', () => setPhoto(simulatedPhoto(load)));
            removeBtn.addEventListener('click', () => { setPhoto(null); form.elements.photoFile.value = ''; });
            form.elements.photoFile.addEventListener('change', async () => {
                const file = form.elements.photoFile.files[0];
                if (!file) return;
                try {
                    setPhoto(await compressPhoto(file));
                    showError('');
                } catch (error) {
                    showError(error.message, 'No se pudo usar la foto');
                }
            });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const receiverName = form.elements.receiverName.value.trim();
                if (!receiverName) return showError('Indique el nombre de quien recibe la carga.');
                if (pad.isEmpty()) return showError('La entrega requiere la firma de quien recibe.');
                showError('');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Registrando…</span>';
                try {
                    await onSubmit({
                        receiverName,
                        receiverDocument: form.elements.receiverDocument.value.trim() || null,
                        notes: form.elements.notes.value.trim() || null,
                        signatureBlob: await window.PodEvidence.dataUrlToBlob(pad.toDataUrl()),
                        photoBlob: photoDataUrl ? await window.PodEvidence.dataUrlToBlob(photoDataUrl) : null
                    });
                    finish(true);
                } catch (error) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = icon('arrows-clockwise') + '<span>Reintentar entrega</span>';
                    showError(window.ui.errorMessage(error) + '. La firma y la foto siguen en este formulario: revise la señal e intente de nuevo.',
                        'No se pudo registrar la entrega');
                }
            });
            form.elements.receiverName.focus();
        });
    }

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
                        ${pod.signatureUrl
                            ? `<img src="${esc(pod.signatureUrl)}" alt="Firma de ${esc(pod.receiverName || 'quien recibe')}" class="w-full max-h-36 object-contain border border-slate-200 rounded-xl bg-white">`
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

    async function showProofOfDelivery(loadId, load) {
        const overlay = mountOverlay('pod-viewer-modal', `
            <div class="overflow-y-auto px-4 pt-1 space-y-3">
                <div id="pod-viewer-body" class="bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center text-slate-300 text-xs">
                    <i class="fas fa-spinner fa-spin text-lg mb-2 block"></i> Consultando la prueba de entrega…
                </div>
                <button type="button" data-action="close" class="btn-secondary w-full">Cerrar</button>
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
