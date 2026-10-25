FROM node:24-bookworm-slim AS verification
WORKDIR /verify
COPY package.json *.mjs privacy.html Dockerfile .dockerignore ./
RUN node --test

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/events.sqlite
WORKDIR /app
COPY --from=verification --chown=node:node /verify/package.json /verify/server.mjs /verify/assistant.mjs /verify/ai.mjs /verify/owner-tools.mjs /verify/delivery.mjs /verify/doctor.mjs /verify/privacy.html ./
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
