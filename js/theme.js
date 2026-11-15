(function () {
    const STORAGE_KEY = 'truckcar.theme.preference';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    let preference = 'system';

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
    } catch (error) {}

    function resolvedTheme() {
        return preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    }

    function apply() {
        const theme = resolvedTheme();
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.dataset.themePreference = preference;
        root.style.colorScheme = theme;
        if (themeColor) themeColor.content = theme === 'dark' ? '#0C0E12' : '#F6F7F9';
        document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = preference; });
        window.dispatchEvent(new window.CustomEvent('truckcar:themechange', { detail: { theme, preference } }));
    }

    const api = {
        getPreference: () => preference,
        getTheme: resolvedTheme,
        selector(className = 'theme-select') {
            return `<label class="theme-select-wrap"><span class="sr-only">Tema visual</span><select data-theme-select aria-label="Tema visual" class="${className}">
                <option value="system"${preference === 'system' ? ' selected' : ''}>Automático</option>
                <option value="light"${preference === 'light' ? ' selected' : ''}>Claro</option>
                <option value="dark"${preference === 'dark' ? ' selected' : ''}>Oscuro</option>
            </select></label>`;
        },
        setPreference(value) {
            if (!['system', 'light', 'dark'].includes(value)) return;
            preference = value;
            try { localStorage.setItem(STORAGE_KEY, value); } catch (error) {}
            apply();
        }
    };

    document.addEventListener('change', event => {
        if (event.target.matches('[data-theme-select]')) api.setPreference(event.target.value);
    });
    document.addEventListener('DOMContentLoaded', apply, { once: true });
    media.addEventListener ? media.addEventListener('change', () => { if (preference === 'system') apply(); })
        : media.addListener(() => { if (preference === 'system') apply(); });
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY && ['system', 'light', 'dark'].includes(event.newValue)) {
            preference = event.newValue;
            apply();
        }
    });

    window.TruckCarTheme = api;
    apply();
})();
