# Plain Node relay for Fly.io (or any container host). No dependencies.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=8080 DATA_FILE=/data/relay-data.json
EXPOSE 8080
CMD ["node", "src/node-server.js"]
