/**
 * Tailwind se compila en el despliegue (npm run build:css → css/tailwind.css), no en el navegador con el CDN.
 * Es la misma configuración que antes vivía en index.html: los colores y la tipografía son los tokens de
 * css/tokens.css (fuente única) y los matices del diseño anterior apuntan al token con su significado.
 * Versión fija (package.json): la misma 3.4.17 que servía cdn.tailwindcss.com.
 */
module.exports = {
    content: ["./index.html", "./js/**/*.js"],
    "future": {
        "hoverOnlyWhenSupported": true
    },
    "theme": {
        "extend": {
            "colors": {
                "graphite": {
                    "50": "rgb(var(--graphite-50) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-500) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "slate": {
                    "50": "rgb(var(--graphite-50) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-500) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "white": "rgb(var(--graphite-100) / <alpha-value>)",
                "accent": {
                    "300": "rgb(var(--accent-300) / <alpha-value>)",
                    "400": "rgb(var(--accent-400) / <alpha-value>)",
                    "500": "rgb(var(--accent-500) / <alpha-value>)",
                    "600": "rgb(var(--accent-600) / <alpha-value>)",
                    "700": "rgb(var(--accent-700) / <alpha-value>)"
                },
                "brand": {
                    "50": "rgb(var(--accent-300) / <alpha-value>)",
                    "300": "rgb(var(--accent-300) / <alpha-value>)",
                    "400": "rgb(var(--accent-400) / <alpha-value>)",
                    "500": "rgb(var(--accent-500) / <alpha-value>)",
                    "600": "rgb(var(--accent-500) / <alpha-value>)",
                    "700": "rgb(var(--accent-600) / <alpha-value>)",
                    "900": "rgb(var(--accent-700) / <alpha-value>)"
                },
                "ok": {
                    "400": "rgb(var(--ok-400) / <alpha-value>)",
                    "500": "rgb(var(--ok-500) / <alpha-value>)",
                    "700": "rgb(var(--ok-700) / <alpha-value>)"
                },
                "warn": {
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "sos": {
                    "400": "rgb(var(--sos-400) / <alpha-value>)",
                    "500": "rgb(var(--sos-500) / <alpha-value>)",
                    "600": "rgb(var(--sos-600) / <alpha-value>)",
                    "700": "rgb(var(--sos-700) / <alpha-value>)"
                },
                "emerald": {
                    "50": "rgb(var(--ok-400) / <alpha-value>)",
                    "100": "rgb(var(--ok-400) / <alpha-value>)",
                    "200": "rgb(var(--ok-400) / <alpha-value>)",
                    "300": "rgb(var(--ok-400) / <alpha-value>)",
                    "400": "rgb(var(--ok-400) / <alpha-value>)",
                    "500": "rgb(var(--ok-500) / <alpha-value>)",
                    "600": "rgb(var(--ok-500) / <alpha-value>)",
                    "700": "rgb(var(--ok-700) / <alpha-value>)",
                    "800": "rgb(var(--ok-700) / <alpha-value>)",
                    "900": "rgb(var(--ok-700) / <alpha-value>)",
                    "950": "rgb(var(--ok-700) / <alpha-value>)"
                },
                "green": {
                    "50": "rgb(var(--ok-400) / <alpha-value>)",
                    "100": "rgb(var(--ok-400) / <alpha-value>)",
                    "200": "rgb(var(--ok-400) / <alpha-value>)",
                    "300": "rgb(var(--ok-400) / <alpha-value>)",
                    "400": "rgb(var(--ok-400) / <alpha-value>)",
                    "500": "rgb(var(--ok-500) / <alpha-value>)",
                    "600": "rgb(var(--ok-500) / <alpha-value>)",
                    "700": "rgb(var(--ok-700) / <alpha-value>)",
                    "800": "rgb(var(--ok-700) / <alpha-value>)",
                    "900": "rgb(var(--ok-700) / <alpha-value>)",
                    "950": "rgb(var(--ok-700) / <alpha-value>)"
                },
                "amber": {
                    "50": "rgb(var(--warn-400) / <alpha-value>)",
                    "100": "rgb(var(--warn-400) / <alpha-value>)",
                    "200": "rgb(var(--warn-400) / <alpha-value>)",
                    "300": "rgb(var(--warn-400) / <alpha-value>)",
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "600": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)",
                    "800": "rgb(var(--warn-700) / <alpha-value>)",
                    "900": "rgb(var(--warn-700) / <alpha-value>)",
                    "950": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "yellow": {
                    "50": "rgb(var(--warn-400) / <alpha-value>)",
                    "100": "rgb(var(--warn-400) / <alpha-value>)",
                    "200": "rgb(var(--warn-400) / <alpha-value>)",
                    "300": "rgb(var(--warn-400) / <alpha-value>)",
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "600": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)",
                    "800": "rgb(var(--warn-700) / <alpha-value>)",
                    "900": "rgb(var(--warn-700) / <alpha-value>)",
                    "950": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "orange": {
                    "50": "rgb(var(--warn-400) / <alpha-value>)",
                    "100": "rgb(var(--warn-400) / <alpha-value>)",
                    "200": "rgb(var(--warn-400) / <alpha-value>)",
                    "300": "rgb(var(--warn-400) / <alpha-value>)",
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "600": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)",
                    "800": "rgb(var(--warn-700) / <alpha-value>)",
                    "900": "rgb(var(--warn-700) / <alpha-value>)",
                    "950": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "rose": {
                    "50": "rgb(var(--warn-400) / <alpha-value>)",
                    "100": "rgb(var(--warn-400) / <alpha-value>)",
                    "200": "rgb(var(--warn-400) / <alpha-value>)",
                    "300": "rgb(var(--warn-400) / <alpha-value>)",
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "600": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)",
                    "800": "rgb(var(--warn-700) / <alpha-value>)",
                    "900": "rgb(var(--warn-700) / <alpha-value>)",
                    "950": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "red": {
                    "50": "rgb(var(--warn-400) / <alpha-value>)",
                    "100": "rgb(var(--warn-400) / <alpha-value>)",
                    "200": "rgb(var(--warn-400) / <alpha-value>)",
                    "300": "rgb(var(--warn-400) / <alpha-value>)",
                    "400": "rgb(var(--warn-400) / <alpha-value>)",
                    "500": "rgb(var(--warn-500) / <alpha-value>)",
                    "600": "rgb(var(--warn-500) / <alpha-value>)",
                    "700": "rgb(var(--warn-700) / <alpha-value>)",
                    "800": "rgb(var(--warn-700) / <alpha-value>)",
                    "900": "rgb(var(--warn-700) / <alpha-value>)",
                    "950": "rgb(var(--warn-700) / <alpha-value>)"
                },
                "blue": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "sky": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "indigo": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "violet": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "purple": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "cyan": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "teal": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "fuchsia": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "pink": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                },
                "lime": {
                    "50": "rgb(var(--graphite-100) / <alpha-value>)",
                    "100": "rgb(var(--graphite-100) / <alpha-value>)",
                    "200": "rgb(var(--graphite-200) / <alpha-value>)",
                    "300": "rgb(var(--graphite-300) / <alpha-value>)",
                    "400": "rgb(var(--graphite-400) / <alpha-value>)",
                    "500": "rgb(var(--graphite-400) / <alpha-value>)",
                    "600": "rgb(var(--graphite-600) / <alpha-value>)",
                    "700": "rgb(var(--graphite-700) / <alpha-value>)",
                    "800": "rgb(var(--graphite-800) / <alpha-value>)",
                    "900": "rgb(var(--graphite-900) / <alpha-value>)",
                    "950": "rgb(var(--graphite-950) / <alpha-value>)"
                }
            },
            "fontFamily": {
                "sans": [
                    "var(--font-sans)"
                ],
                "mono": [
                    "var(--font-sans)"
                ]
            }
        }
    }
};
