FROM node:20

# Install Python + pip + ffmpeg and ensure yt-dlp is in predictable location
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl \
  && echo "Installing yt-dlp..." \
  && pip3 install --no-cache-dir yt-dlp \
  && echo "Checking pip3 installation locations..." \
  && python3 -m pip show -f yt-dlp | head -20 \
  && echo "Checking for yt-dlp binary..." \
  && find /usr -name "yt-dlp*" 2>/dev/null || true \
  && echo "Checking PATH and python user base..." \
  && echo "PATH: $PATH" \
  && python3 -m site --user-base \
  && echo "Adding python user bin to PATH..." \
  && export PATH="$PATH:$(python3 -m site --user-base)/bin:/usr/local/bin:/usr/bin" \
  && echo "New PATH: $PATH" \
  && echo "Attempting to find yt-dlp..." \
  && which yt-dlp || echo "yt-dlp not found in PATH, trying alternatives..." \
  && if [ -f /usr/local/bin/yt-dlp ]; then \
       echo "Found yt-dlp at /usr/local/bin/yt-dlp"; \
     elif [ -f /usr/bin/yt-dlp ]; then \
       echo "Found yt-dlp at /usr/bin/yt-dlp"; \
     elif [ -f "$(python3 -m site --user-base)/bin/yt-dlp" ]; then \
       echo "Found yt-dlp in user bin, creating symlink..."; \
       ln -sf "$(python3 -m site --user-base)/bin/yt-dlp" /usr/local/bin/yt-dlp; \
     else \
       echo "yt-dlp not found, trying direct installation to /usr/local/bin..."; \
       curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp; \
       chmod +x /usr/local/bin/yt-dlp; \
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

# Set environment variables
ENV NODE_ENV=production
ENV PATH="${PATH}:/usr/local/bin:/usr/bin:/home/node/.local/bin:/root/.local/bin"

CMD ["npm", "start"]
