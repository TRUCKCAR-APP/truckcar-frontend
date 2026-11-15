window.Toaster = (function () {
    const VISIBLE = 3;
    const GAP = 10;
    const DURATION = 5000;
    const SWIPE_DISTANCE = 56;
    const SWIPE_VELOCITY = 0.11;
    const ICONS = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    let root = null;
    let toasts = [];
    let expanded = false;
    let nextId = 1;

    function ensureRoot() {
        if (root) return root;
        root = document.createElement('section');
        root.className = 'toaster';
        root.setAttribute('aria-label', 'Notificaciones');
        root.setAttribute('aria-live', 'polite');
        root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setExpanded(true); });
        root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setExpanded(false); });
        document.body.appendChild(root);
        document.addEventListener('visibilitychange', () => toasts.forEach(t => (document.hidden ? pause(t) : resume(t))));
        return root;
    }

    function setExpanded(value) {
        expanded = value;
        root.dataset.expanded = String(value);
        toasts.forEach(t => (value ? pause(t) : resume(t)));
        layout();
    }

    function layout() {
        let offset = 0;
        toasts.slice().reverse().forEach((t, index) => {
            const el = t.el;
            el.style.setProperty('--index', String(index));
            el.style.setProperty('--offset', offset + 'px');
            el.style.zIndex = String(100 - index);
            el.dataset.hidden = String(index >= VISIBLE);
            offset += el.offsetHeight + GAP;
        });
        root.style.height = expanded ? offset + 'px' : '0px';
    }

    function pause(t) {
        if (!t.timer) return;
        clearTimeout(t.timer);
        t.timer = null;
        t.remaining -= Date.now() - t.startedAt;
    }

    function resume(t) {
        if (t.timer || expanded || document.hidden || t.duration === Infinity) return;
        t.startedAt = Date.now();
        t.timer = setTimeout(() => dismiss(t.id), Math.max(800, t.remaining));
    }

    function dismiss(id, direction) {
        const t = toasts.find(x => x.id === id);
        if (!t) return;
        clearTimeout(t.timer);
        toasts = toasts.filter(x => x !== t);
        const el = t.el;
        el.style.transition = 'transform 260ms var(--ease-out), opacity 200ms var(--ease-out)';
        el.style.transform = direction
            ? `translateX(${direction * 110}%)`
            : 'translateY(calc(var(--index) * -12px + 12px)) scale(0.96)';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 280);
        layout();
    }

    function bindSwipe(t) {
        const el = t.el;
        let startX = 0;
        let startTime = 0;
        let dx = 0;
        let active = false;
        el.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.toast-action')) return;
            active = true;
            startX = e.clientX;
            startTime = performance.now();
            dx = 0;
            el.setPointerCapture(e.pointerId);
            el.classList.add('is-swiping');
            pause(t);
        });
        el.addEventListener('pointermove', (e) => {
            if (!active) return;
            dx = e.clientX - startX;
            el.style.transform = `translateX(${dx}px)`;
            el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 240));
        });
        const end = () => {
            if (!active) return;
            active = false;
            el.classList.remove('is-swiping');
            const velocity = Math.abs(dx) / Math.max(1, performance.now() - startTime);
            if (Math.abs(dx) > SWIPE_DISTANCE || velocity > SWIPE_VELOCITY) {
                dismiss(t.id, Math.sign(dx) || 1);
                return;
            }
            el.style.transform = '';
            el.style.opacity = '';
            resume(t);
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
    }

    function show(options) {
        const opts = typeof options === 'string' ? { title: options } : options;
        const type = ICONS[opts.type] ? opts.type : 'info';
        ensureRoot();
        const el = document.createElement('div');
        el.className = 'toast';
        el.dataset.type = type;
        el.dataset.mounted = 'false';
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        el.innerHTML = `
            <span class="toast-icon"><i class="fas ${ICONS[type]}"></i></span>
            <div class="min-w-0">
                <div class="toast-title"></div>
                ${opts.description ? '<div class="toast-description"></div>' : ''}
            </div>
            ${opts.action ? '<button type="button" class="toast-action"></button>' : ''}`;
        el.querySelector('.toast-title').textContent = opts.title;
        if (opts.description) el.querySelector('.toast-description').textContent = opts.description;
        const t = {
            id: nextId++,
            el,
            duration: opts.duration || (type === 'error' ? 7000 : DURATION),
            remaining: 0,
            timer: null,
            startedAt: 0
        };
        t.remaining = t.duration;
        if (opts.action) {
            const button = el.querySelector('.toast-action');
            button.textContent = opts.action.label;
            button.addEventListener('click', () => {
                try { opts.action.onClick(); } finally { dismiss(t.id); }
            });
        }
        el.addEventListener('click', () => { if (!expanded && !window.matchMedia('(hover: hover)').matches) setExpanded(true); });
        root.appendChild(el);
        toasts.push(t);
        while (toasts.length > 6) dismiss(toasts[0].id);
        bindSwipe(t);
        layout();
        requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.mounted = 'true'; }));
        resume(t);
        return t.id;
    }

    document.addEventListener('pointerdown', (e) => {
        if (expanded && root && !root.contains(e.target) && e.pointerType !== 'mouse') setExpanded(false);
    });

    return { show, dismiss };
})();
