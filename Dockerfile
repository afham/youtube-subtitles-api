# 1. Use an official Node.js image based on Debian slim
FROM node:20-slim

# 2. Install Python3, FFmpeg, and python-is-python3 (creates the 'python' symlink)
RUN apt-get update && apt-get install -y \
    python3 \
    python-is-python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 3. Set working directory
WORKDIR /app

# 4. Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# 5. Copy full source code and build TypeScript
COPY . .
RUN npm run build

# 6. Expose port
ENV PORT=5000
EXPOSE 5000

# 7. Start production server
CMD ["node", "dist/server.js"]