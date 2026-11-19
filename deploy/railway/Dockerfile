FROM ghcr.io/gitroomhq/postiz-app@sha256:875e61ac5d0ac43c3dec78a78a7032dfb03d9a8c6d4936ebb18adb606cc207c5

RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY patch-cookie-domains.cjs cookie-domains.test.cjs disable-internal-ai.cjs internal-ai.test.cjs /opt/postiz-railway/
COPY ecosystem.config.cjs reduce-process-overhead.cjs /opt/postiz-railway/
COPY hub /opt/postiz-railway/hub
COPY install-hub.cjs /opt/postiz-railway/
COPY unify-postiz-ui.cjs /opt/postiz-railway/
RUN node /opt/postiz-railway/patch-cookie-domains.cjs \
 && node /opt/postiz-railway/cookie-domains.test.cjs \
 && node /opt/postiz-railway/disable-internal-ai.cjs \
 && node /opt/postiz-railway/internal-ai.test.cjs \
 && node /opt/postiz-railway/unify-postiz-ui.cjs \
 && node /opt/postiz-railway/reduce-process-overhead.cjs \
 && node --test /opt/postiz-railway/hub/domain.test.cjs \
 && node --test /opt/postiz-railway/hub/discovery.test.cjs \
 && node --test /opt/postiz-railway/hub/credentials.test.cjs \
 && node --check /opt/postiz-railway/hub/credentials.cjs \
 && node --check /opt/postiz-railway/hub/connections.cjs \
 && node --check /opt/postiz-railway/hub/public/connections.js \
 && node /opt/postiz-railway/hub/artwork.test.cjs \
 && node --check /opt/postiz-railway/hub/server.cjs \
 && node --check /opt/postiz-railway/hub/public/app.js \
 && node /opt/postiz-railway/install-hub.cjs \
 && nginx -t

CMD ["sh", "-c", "unset PORT; nginx && pnpm run pm2"]
