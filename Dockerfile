# Use Node image
FROM node:18

# Install required libraries
RUN apt-get update && apt-get install -y \
    chromium \
    libglib2.0-0 \
    libnss3 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxdamage1 \
    libxfixes3 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libx11-6 \
    ca-certificates \
    fonts-liberation \
    wget

# Set working dir
WORKDIR /app

# Copy files
COPY package*.json ./
RUN npm install

COPY . .

# Start app
CMD ["node", "index.js"]