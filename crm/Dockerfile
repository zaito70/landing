FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json server.ts ./
COPY public ./public
# En Railway, monta un volumen en /data para que los leads no se pierdan al redesplegar.
RUN mkdir -p /data
ENV DB_PATH=/data/crm.sqlite
CMD ["bun", "run", "server.ts"]
