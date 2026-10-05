# Web build of DevPanel served by nginx (dev preview / self-hosting).
#   docker build -t devpanel-web .   &&   docker run -p 8080:80 devpanel-web

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.renderer.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build:web

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/renderer /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
