FROM node:20

# Install Python + pip + ffmpeg and ensure yt-dlp is in predictable location
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg \
  && pip3 install --no-cache-dir yt-dlp \
  && echo "Checking yt-dlp installation..." \
  && which yt-dlp \
  && YTDLP_ACTUAL_PATH=$(which yt-dlp) \
  && echo "Found yt-dlp at: $YTDLP_ACTUAL_PATH" \
  && if [ "$YTDLP_ACTUAL_PATH" != "/usr/local/bin/yt-dlp" ]; then \
       echo "Creating symlink at /usr/local/bin/yt-dlp"; \
       ln -sf "$YTDLP_ACTUAL_PATH" /usr/local/bin/yt-dlp; \
     fi \
  && echo "Final verification:" \
  && ls -la /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version

# Set app directory
WORKDIR /app

# Install node dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

ENV NODE_ENV=production
CMD ["npm", "start"]
