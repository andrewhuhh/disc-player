# Netlify Functions for Disc Player

This directory contains serverless functions that handle API requests for the Disc Player application, eliminating the need for a separate backend server.

## Functions

### 1. generate-music.js
Proxies music generation requests to the ElevenLabs API.

**Endpoint:** `/api/generate-music`  
**Method:** POST  
**Request Body:**
```json
{
  "prompt": "string - music description",
  "length": "number - duration in milliseconds (optional, default: 10000)",
  "apiKey": "string - ElevenLabs API key (required)"
}
```
**Response:** Audio file (MP3) as binary data with base64 encoding

### 2. generate-song-metadata.js
Generates creative song titles and artist names using a free LLM API.

**Endpoint:** `/api/generate-song-metadata`  
**Method:** POST  
**Request Body:**
```json
{
  "prompt": "string - music description"
}
```
**Response:**
```json
{
  "title": "string - generated song title",
  "author": "string - generated artist name"
}
```

### 3. generate-cover-image.js
Generates album cover art using the Pollinations text-to-image API.

**Endpoint:** `/api/generate-cover-image`  
**Method:** POST  
**Request Body:**
```json
{
  "prompt": "string - music description"
}
```
**Response:** Image file (JPEG) as binary data with base64 encoding

## Deployment

### Prerequisites
1. A Netlify account
2. The repository connected to Netlify

### Automatic Deployment
Once this repository is connected to Netlify:
1. Push these changes to your repository
2. Netlify will automatically detect the functions in the `netlify/functions` directory
3. The `netlify.toml` file will configure the redirects from `/api/*` to the functions
4. Dependencies will be automatically installed from `package.json`

### Manual Deployment
If you need to deploy manually:
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod
```

## CORS Configuration
All functions include CORS headers to allow requests from any origin:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Content-Type`
- `Access-Control-Allow-Methods: POST, OPTIONS`

## Error Handling
Each function includes comprehensive error handling:
- Validation errors (400)
- Authentication errors (401) 
- Rate limiting (429)
- Server errors (500)

All errors return JSON responses with error messages and appropriate status codes.

## Environment Variables
The ElevenLabs API key is passed from the frontend for security. In production, consider:
1. Storing the API key as a Netlify environment variable
2. Removing the `apiKey` parameter from the request
3. Using the environment variable in the function: `process.env.ELEVENLABS_API_KEY`

## Testing Locally
To test functions locally:
```bash
# Install dependencies
npm install

# Run Netlify Dev
netlify dev
```

This will start a local server with the functions available at `http://localhost:8888/api/*`

## Monitoring
View function logs in the Netlify dashboard:
1. Go to your site dashboard
2. Click on "Functions" tab
3. View real-time logs and metrics

## Rate Limits
- ElevenLabs API: Subject to your plan's limits
- Free LLM API: May have rate limiting (returns 429 status)
- Pollinations API: Generally unlimited but may throttle under heavy load

## Security Notes
- The ElevenLabs API key is currently passed from the frontend
- Consider implementing server-side API key storage for production
- All functions validate input parameters
- No sensitive data is logged