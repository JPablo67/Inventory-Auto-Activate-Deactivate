FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Remove CLI packages if desired, but risky if scripts depend on them. Keeping for now.
# RUN npm remove @shopify/cli

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the app
RUN npm run build

# Prune dev dependencies for smaller image (optional)
# RUN npm prune --production

CMD ["npm", "run", "docker-start"]
