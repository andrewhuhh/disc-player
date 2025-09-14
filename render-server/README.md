# Record Player API Server

Backend server for Record Player app, handling YouTube downloads and audio processing.

## Deployment on Render.com

### Requirements

- Node.js 18.x
- FFmpeg (optional, for advanced audio processing)

### Environment Variables

- `NODE_ENV`: Set to 'production' for production deployment
- `PORT`: Set by Render.com automatically

### Render.com Setup

1. Create a new Web Service
2. Connect your GitHub repository
3. Configure:
   - Root Directory: `render-server`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Node Version: 18.x

### Optional Dependencies

- fluent-ffmpeg: For audio format conversion (installed automatically)

## API Endpoints

- `GET /`: API information and status
- `GET /health`: Health check endpoint
- `GET /youtube-metadata/:videoId`: Get YouTube video metadata
- `POST /youtube-convert`: Convert YouTube video to audio

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start
```
