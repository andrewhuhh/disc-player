FROM node:20

# Install Python + pip + ffmpeg and ensure yt-dlp is in predictable location
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl \
  && echo "Installing yt-dlp..." \
  # Install yt-dlp both as a Python module and as a binary
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  # Ensure the binary is executable and in PATH
  && ln -sf /usr/local/bin/yt-dlp /usr/bin/yt-dlp \
  # Verify installations
  && echo "Verifying yt-dlp installations:" \
  && echo "1. Binary version:" \
  && /usr/local/bin/yt-dlp --version \
  && echo "2. Python module version:" \
  && python3 -m yt_dlp --version \
  # Create necessary directories and set permissions
  && mkdir -p /tmp/yt-dlp \
  && chmod 777 /tmp/yt-dlp

# Set app directory
WORKDIR /app

# Install node dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Set environment variables
ENV NODE_ENV=production \
    PATH="/usr/local/bin:/usr/bin:/home/node/.local/bin:/root/.local/bin:${PATH}" \
    PYTHONPATH="/usr/local/lib/python3.11/site-packages:/usr/lib/python3/dist-packages:${PYTHONPATH}" \
    YTDLP_PATH="/usr/local/bin/yt-dlp"

CMD ["npm", "start"]
