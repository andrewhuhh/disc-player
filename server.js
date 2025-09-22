const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

// Rate limiting setup
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Configure CORS based on environment
const corsOptions = {
    origin: isProduction 
        ? ['https://myrecordplayer.netlify.app']
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
};
app.use(cors(corsOptions));

// Configure Redis for rate limiting
let redisClient;
if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on('error', (err) => console.warn('Redis error:', err));
}

// Configure rate limiter factory
const createLimiter = (windowMs, max, keyPrefix) => {
    const config = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req, res, next) => {
            const ip = rateLimit.ipKeyGenerator(req, res, next);
            const apiKey = req.headers['x-api-key'] || '';
            return `${keyPrefix}:${ip}:${apiKey}`;
        },
        handler: (req, res) => {
            res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil(windowMs / 1000),
                type: 'rate_limit_exceeded'
            });
        }
    };

    if (redisClient) {
        config.store = new RedisStore({
            sendCommand: (...args) => redisClient.call(...args),
            prefix: `${keyPrefix}:rl:`
        });
    }

    return rateLimit(config);
};

// Global rate limit
app.use(createLimiter(
    60 * 1000, // 1 minute window
    60,        // 60 requests per window
    'global'
));

// Root API info endpoint
app.get('/api/', (req, res) => {
    res.json({ 
        status: 'ok',
        service: 'Record Player API',
        version: '1.0.0',
        endpoints: [
            '/api/generate-music',
            '/api/generate-cover-image',
            '/api/generate-song-metadata',
            '/api/health'
        ]
    });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        res.json({ 
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: isProduction ? 'production' : 'development',
            node_version: process.version,
            platform: process.platform
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Health check failed',
            details: isProduction ? undefined : error.message
        });
    }
});

// Security middleware for production
if (isProduction) {
    const helmet = require('helmet');
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    }));
}

// Serve static files based on environment
if (!isProduction) {
    app.use(express.static('./'));
}
app.use(express.json());

// Create and configure temp directory
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Clean up temp files older than 1 hour
cleanupTempFiles();

function generateTempFilename() {
    return crypto.randomBytes(16).toString('hex');
}

function cleanupTempFiles() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    fs.readdir(tempDir, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (stats.mtimeMs < oneHourAgo) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}

setInterval(cleanupTempFiles, 60 * 60 * 1000);

// Music generation endpoint
app.post('/api/generate-music', async (req, res) => {
    const { prompt, length = 10000, apiKey } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!apiKey) {
        return res.status(400).json({ error: 'ElevenLabs API key is required' });
    }

    const outputFile = path.join(tempDir, `${generateTempFilename()}.mp3`);

    try {
        const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
        
        const elevenlabs = new ElevenLabsClient({
            apiKey: apiKey,
        });

        console.log('Generating music with prompt:', prompt);
        
        const track = await elevenlabs.music.compose({
            prompt: prompt,
            musicLengthMs: parseInt(length),
        });

        console.log('ElevenLabs API Response Type:', typeof track);

        let audioData;
        if (typeof ReadableStream !== 'undefined' && track instanceof ReadableStream) {
            console.log('Converting ReadableStream to audio data...');
            const reader = track.getReader();
            const chunks = [];
            let done = false;
            let totalBytes = 0;
            
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    chunks.push(value);
                    totalBytes += value.length;
                    console.log(`Read chunk: ${value.length} bytes (total: ${totalBytes} bytes)`);
                }
            }
            
            console.log(`Total chunks received: ${chunks.length}`);
            console.log(`Total audio data size: ${totalBytes} bytes`);
            
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            audioData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }
            
            console.log(`Final audio data size: ${audioData.length} bytes`);
            console.log(`First 20 bytes of audio data:`, Array.from(audioData.slice(0, 20)));
        } else {
            console.log('Track is not a ReadableStream, using as-is');
            audioData = track;
            console.log(`Audio data type: ${typeof audioData}`);
            console.log(`Audio data length: ${audioData?.length || 'unknown'}`);
        }

        fs.writeFileSync(outputFile, audioData);

        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Music generation produced no output file');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="generated-music.mp3"');

        res.sendFile(outputFile, (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            fs.unlink(outputFile, () => {});
        });

    } catch (error) {
        console.error('Music generation error:', error);
        
        let errorResponse = {
            error: error.message || 'Music generation failed',
            type: 'generic'
        };
        
        if (error.statusCode) {
            errorResponse.statusCode = error.statusCode;
            
            if (error.body && error.body.detail) {
                const detail = error.body.detail;
                errorResponse.type = detail.status || 'api_error';
                errorResponse.message = detail.message || error.message;
                
                if (detail.data && detail.data.prompt_suggestion) {
                    errorResponse.promptSuggestion = detail.data.prompt_suggestion;
                }
            }
        }
        
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json(errorResponse);
        
        if (fs.existsSync(outputFile)) {
            fs.unlink(outputFile, () => {});
        }
    }
});

// Generate song metadata using free LLM service
app.post('/api/generate-song-metadata', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        const systemPrompt = `Based on this music description, generate a creative song title and artist name. Return ONLY a JSON object with "title" and "author" fields, nothing else. Make the title catchy and the artist name creative but believable. Music description: "${prompt}"`;

        const response = await fetch('https://apifreellm.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: systemPrompt
            })
        });

        if (!response.ok) {
            throw new Error(`LLM API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        if (data.status === 'rate_limited') {
            return res.status(429).json({ 
                error: data.error || 'Rate limit exceeded',
                retry_after: data.retry_after || 5
            });
        }

        if (data.status !== 'success' && data.status !== 'succes') {
            throw new Error(data.error || 'LLM API request failed');
        }

        let metadata = { title: 'Generated Music', author: 'AI Artist' };
        
        try {
            const jsonMatch = data.response.match(/\{[^}]*"title"[^}]*"author"[^}]*\}/i) || 
                             data.response.match(/\{[^}]*"author"[^}]*"title"[^}]*\}/i);
            
            if (jsonMatch) {
                const parsedJson = JSON.parse(jsonMatch[0]);
                if (parsedJson.title && parsedJson.author) {
                    metadata.title = parsedJson.title.trim();
                    metadata.author = parsedJson.author.trim();
                }
            } else {
                const parsedResponse = JSON.parse(data.response);
                if (parsedResponse.title && parsedResponse.author) {
                    metadata.title = parsedResponse.title.trim();
                    metadata.author = parsedResponse.author.trim();
                }
            }
        } catch (parseError) {
            const titleMatch = data.response.match(/"?title"?\s*:?\s*"?([^",\n]+)"?/i);
            const authorMatch = data.response.match(/"?author"?\s*:?\s*"?([^",\n]+)"?/i) ||
                              data.response.match(/"?artist"?\s*:?\s*"?([^",\n]+)"?/i);
            
            if (titleMatch) metadata.title = titleMatch[1].trim().replace(/['"]/g, '');
            if (authorMatch) metadata.author = authorMatch[1].trim().replace(/['"]/g, '');
            
            console.log('Fallback regex extraction used for LLM response');
        }

        res.json(metadata);

    } catch (error) {
        console.error('LLM metadata generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate song metadata',
            fallback: { title: 'Generated Music', author: 'AI Artist' }
        });
    }
});

// Generate cover image using text-to-image API
app.post('/api/generate-cover-image', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        const imagePrompt = `Album cover art for: ${prompt}. Artistic, vibrant, music-themed design`;
        const seed = Math.floor(Math.random() * 100) + 1;
        const apiUrl = new URL('https://image.pollinations.ai/prompt/' + encodeURIComponent(imagePrompt));
        apiUrl.searchParams.set('model', 'flux');
        apiUrl.searchParams.set('width', '240');
        apiUrl.searchParams.set('height', '240');
        apiUrl.searchParams.set('seed', seed.toString());
        apiUrl.searchParams.set('nologo', 'true');

        console.log('Generating cover image with URL:', apiUrl.toString());

        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
            throw new Error(`Image generation failed with status ${response.status}`);
        }

        const imageBuffer = await response.arrayBuffer();
        
        if (!imageBuffer || imageBuffer.byteLength === 0) {
            throw new Error('Image generation produced no data');
        }

        console.log(`Generated cover image size: ${imageBuffer.byteLength} bytes`);

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', imageBuffer.byteLength);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        res.send(Buffer.from(imageBuffer));

    } catch (error) {
        console.error('Cover image generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate cover image',
            message: error.message || 'Image generation failed'
        });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    const errorMessage = isProduction 
        ? 'An internal server error occurred'
        : err.message || 'Unknown error';
        
    res.status(err.status || 500).json({
        error: errorMessage,
        status: err.status || 500
    });
});

// Handle 404s
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        status: 404
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running in ${isProduction ? 'production' : 'development'} mode`);
    console.log(`Listening on port ${port}`);
});
