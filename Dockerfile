ARG NODE_VERSION=21-alpine3.19

# Base
FROM node:${NODE_VERSION} AS base

# Create app directory
WORKDIR /usr/src/veritify

# Dependencies Production
FROM base AS deps

# Install app dependencies using the `npm ci` command instead of `npm install`
COPY package.json package-lock.json ./
RUN npm ci --omit=dev 

# Build
FROM base AS build

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

# Run the build command which creates the production bundle
RUN npm run build

# Final
FROM base AS final

# Set NODE_ENV environment variable
ENV NODE_ENV=prod

RUN apk add --no-cache curl

# Copy package.json
COPY package.json ./

# Copy node_modules from dependencies stage
COPY --from=deps /usr/src/veritify/node_modules ./node_modules

# Copy built files from build stage
COPY --from=build /usr/src/veritify/dist ./dist

# Setting port
EXPOSE 5000

# Start the server using the production build
CMD ["npm", "run", "start:prod"]