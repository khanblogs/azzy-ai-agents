# Routes + security headers shared by the HTTP and HTTPS server blocks.
# Included inside server{} by azzy.conf and azzy-tls.conf (not globbed: *.inc).
#
# proxy_pass uses variables + Docker's embedded DNS (127.0.0.11) so nginx
# re-resolves `api` / `web` after `docker compose up -d --force-recreate`
# instead of caching the first container IP.

resolver 127.0.0.11 valid=10s ipv6=off;
set $api_upstream http://api:8000;
set $web_upstream http://web:3000;

add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# Next.js inline runtime + three.js blob workers + drei HDRI CDNs + same-origin WS.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.jsdelivr.net https://raw.githack.com; font-src 'self' data:; connect-src 'self' ws: wss: blob: data: https://cdn.jsdelivr.net https://raw.githack.com; worker-src 'self' blob:; child-src 'self' blob:; media-src 'self' blob: data:; manifest-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" always;

# WebSocket: long-lived, upgrade headers passed through.
location = /api/ws {
    proxy_pass $api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

# REST API — the /api prefix is kept (FastAPI mounts under /api).
location /api/ {
    proxy_pass $api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 120s;
    proxy_buffering off;
}

# Prometheus text metrics are internal only: scrape http://api:8000/metrics from the
# compose network; never exposed through the proxy.
location = /metrics {
    return 404;
}

location = /healthz {
    proxy_pass $api_upstream/healthz;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    access_log off;
}

# Next.js app (pages, static, PWA manifest, service worker). Upgrade headers
# let the dev-only HMR socket through if someone points nginx at `next dev`.
location / {
    proxy_pass $web_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 120s;
}
