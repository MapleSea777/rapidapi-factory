FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY apis ./apis
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
