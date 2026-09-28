FROM node:20-alpine

WORKDIR /app

# Copy root package definitions
COPY package*.json ./

# Copy client package definitions
COPY client/package*.json ./client/

# Install backend dependencies without triggering postinstall prematurely
RUN npm ci --omit=dev --ignore-scripts

# Install client dependencies and compile Vite frontend
RUN cd client && npm ci && npm run build

# Copy all application source files
COPY . .

EXPOSE 4000
ENV PORT=4000

CMD ["node", "server.js"]
