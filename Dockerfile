FROM node:20

# Install Python + pip + ffmpeg
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
  && pip3 install --no-cache-dir yt-dlp

# Set app directory
WORKDIR /app

# Install node dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

ENV NODE_ENV=production
CMD ["npm", "start"]
