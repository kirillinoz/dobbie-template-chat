# Dockerfile
# Use the Node.js 22 (LTS) image
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm

# Set up the working directory
WORKDIR /app

# Copy package files and install dependencies
# This caches the install step
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Pre-compile the contracts
# This ensures artifacts are built into the image
RUN pnpm hardhat compile

# The default command will be set in docker-compose.yml
CMD ["pnpm", "hardhat", "test"]