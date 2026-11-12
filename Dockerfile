FROM node:20-alpine AS css
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tailwind.config.cjs index.html ./
COPY css ./css
COPY js ./js
RUN npm run build:css

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY fonts /usr/share/nginx/html/fonts
COPY css /usr/share/nginx/html/css
COPY --from=css /app/css/tailwind.css /usr/share/nginx/html/css/tailwind.css
COPY js /usr/share/nginx/html/js
