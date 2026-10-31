# Imagen de la PWA para Kubernetes (Deployment-Infrastructure/k8s/base/apps/frontend.yaml): nginx sin root en :8080.
# La configuración de nginx la monta el clúster (ConfigMap frontend-nginx); en docker-compose se sirve la carpeta.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
