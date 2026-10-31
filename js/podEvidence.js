/**
 * Evidencias de entrega (firma y foto) con URLs prefirmadas: el archivo binario va directo al almacenamiento S3 y a
 * la API solo llegan su clave, tipo, tamaño y SHA-256. La URL de subida solo acepta exactamente ese contenido.
 */
(function () {
    const api = () => window.TruckCarApi;

    async function sha256Hex(blob) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /** data URL (canvas de la firma, foto comprimida) a Blob binario. */
    async function dataUrlToBlob(dataUrl) {
        return (await fetch(dataUrl)).blob();
    }

    /**
     * El almacenamiento se sirve en /pod-media/ del mismo origen que la app (nginx), así que se usa la ruta firmada
     * contra el origen actual: funciona igual si la app se abrió como localhost o 127.0.0.1.
     */
    function sameOrigin(url) {
        const parsed = new URL(url, window.location.href);
        return parsed.pathname.startsWith('/pod-media/')
            ? window.location.origin + parsed.pathname + parsed.search
            : parsed.toString();
    }

    /**
     * Sube los Blobs { signature, photo } de una carga y devuelve sus referencias para la entrega:
     * { signature: { objectKey, sha256, contentType, sizeBytes }, photo: {...} }.
     */
    async function upload(loadId, blobs) {
        const entries = Object.entries(blobs || {}).filter(([, blob]) => blob);
        if (!entries.length) return {};
        const files = await Promise.all(entries.map(async ([name, blob]) => ({
            name,
            blob,
            kind: name === 'signature' ? 'SIGNATURE' : 'PHOTO',
            contentType: blob.type || 'image/png',
            sizeBytes: blob.size,
            sha256: await sha256Hex(blob)
        })));
        const response = await api().loads.podUploadUrls(loadId, files.map(f => ({
            kind: f.kind, contentType: f.contentType, sizeBytes: f.sizeBytes, sha256: f.sha256
        })));
        const references = {};
        for (const file of files) {
            const target = response.uploads.find(u => u.kind === file.kind);
            const put = await fetch(sameOrigin(target.uploadUrl), {
                method: target.method || 'PUT',
                headers: target.headers || {},
                body: file.blob
            });
            if (!put.ok) {
                const error = new Error('El almacenamiento rechazó la evidencia ' + file.kind + ' (HTTP ' + put.status + ')');
                error.status = put.status >= 500 ? 503 : put.status;
                throw error;
            }
            references[file.name] = {
                objectKey: target.objectKey,
                sha256: file.sha256,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes
            };
        }
        return references;
    }

    /** Entrega en línea: sube las evidencias y registra la entrega con sus referencias. */
    async function deliver(loadId, pod, blobs) {
        const references = await upload(loadId, blobs);
        return api().loads.deliver(loadId, { ...pod, ...references });
    }

    window.PodEvidence = { upload, deliver, sha256Hex, dataUrlToBlob };
})();
