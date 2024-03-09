# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.0.30-alpine

USER root

WORKDIR /app

COPY package*.json ./

RUN bun install

RUN bun install --production

COPY . .

RUN bun run build

# run the app
EXPOSE 8000/tcp

EXPOSE 8001/tcp

ENTRYPOINT [ "./dist/app" ]
