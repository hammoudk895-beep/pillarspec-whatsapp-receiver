FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/events.sqlite
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
