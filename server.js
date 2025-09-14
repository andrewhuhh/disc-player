const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

// Rate limiting setup
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Optional dependencies for local development
let ffmpeg, ffmpegPath, NodeID3;
try {
    ffmpeg = require('fluent-ffmpeg');
    ffmpegPath = require('ffmpeg-static');
    NodeID3 = require('node-id3');
} catch (error) {
    console.warn('Optional dependencies not available for local development:', error.message);
}

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Helper function to check if yt-dlp is installed
function checkYtDlp() {
    return new Promise((resolve) => {
        // Try both global pip installation and local paths
        const paths = ['yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
        let tried = 0;
        
        function tryPath(index) {
            if (index >= paths.length) {
                console.error('yt-dlp not found in any standard location');
                resolve(false);
                return;
            }
            
            const ytdlp = spawn(paths[index], ['--version']);
            
            ytdlp.on('error', (err) => {
                console.error(`yt-dlp check error for ${paths[index]}:`, err.message);
                tryPath(index + 1);
            });
            
            ytdlp.on('close', (code) => {
                if (code === 0) {
                    console.log(`yt-dlp found at ${paths[index]}`);
                    resolve(true);
                } else {
                    tryPath(index + 1);
                }
            });
        }
        
        tryPath(0);
    });
}

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

// Configure rate limiters
const createLimiter = (windowMs, max, keyPrefix) => {
    const config = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req, res, next) => {
            // Use express-rate-limit's built-in IP key generator
            const ip = rateLimit.ipKeyGenerator(req, res, next);
            // Add optional API key to the key
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

    // Use Redis store if available
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

// YouTube-specific rate limits
const youtubeMetadataLimiter = createLimiter(
    60 * 1000,  // 1 minute window
    30,         // 30 requests per window
    'yt_meta'
);

const youtubeDownloadLimiter = createLimiter(
    5 * 60 * 1000,  // 5 minute window
    15,             // 15 requests per window
    'yt_dl'
);

// Root API info endpoint
app.get('/api/', (req, res) => {
    res.json({ 
        status: 'ok',
        service: 'Record Player API',
        version: '1.0.0',
        endpoints: [
            '/api/youtube-metadata/:videoId',
            '/api/youtube-convert',
            '/api/generate-music',
            '/api/generate-cover-image',
            '/api/generate-song-metadata',
            '/api/proxy-audio',
            '/api/health'
        ]
    });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        // Check if yt-dlp is installed and working
        const isYtDlpInstalled = await checkYtDlp();
        
        res.json({ 
            status: isYtDlpInstalled ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            environment: isProduction ? 'production' : 'development',
            node_version: process.version,
            platform: process.platform,
            features: {
                ytdlp: isYtDlpInstalled ? 'available' : 'unavailable'
            }
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
        contentSecurityPolicy: false, // Disabled because we need to load external resources
        crossOriginEmbedderPolicy: false // Disabled for audio file handling
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

// Helper to generate safe temporary filenames
function generateTempFilename() {
    return crypto.randomBytes(16).toString('hex');
}

// Clean up temp files older than 1 hour
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

// Run cleanup every hour
setInterval(cleanupTempFiles, 60 * 60 * 1000);

// Note: yt-dlp check removed as we're now using ytdl-core and ffmpeg for YouTube conversion

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
        
        // Generate music using ElevenLabs API
        const track = await elevenlabs.music.compose({
            prompt: prompt,
            musicLengthMs: parseInt(length),
        });

        // Log the full response from ElevenLabs API
        console.log('ElevenLabs API Response Type:', typeof track);

        // Convert ReadableStream to Buffer if needed
        let audioData;
        if (track instanceof ReadableStream) {
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
            
            // Combine chunks into a single Uint8Array
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

        // Write the audio data to a file
        fs.writeFileSync(outputFile, audioData);

        // Check if file exists and has size
        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Music generation produced no output file');
        }

        // Set proper headers
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="generated-music.mp3"');

        // Send the file
        res.sendFile(outputFile, (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            // Clean up the temp file after sending
            fs.unlink(outputFile, () => {});
        });

    } catch (error) {
        console.error('Music generation error:', error);
        
        // Parse ElevenLabs specific errors
        let errorResponse = {
            error: error.message || 'Music generation failed',
            type: 'generic'
        };
        
        // Handle ElevenLabs API errors
        if (error.statusCode) {
            errorResponse.statusCode = error.statusCode;
            
            if (error.body && error.body.detail) {
                const detail = error.body.detail;
                errorResponse.type = detail.status || 'api_error';
                errorResponse.message = detail.message || error.message;
                
                // Include prompt suggestion if available
                if (detail.data && detail.data.prompt_suggestion) {
                    errorResponse.promptSuggestion = detail.data.prompt_suggestion;
                }
            }
        }
        
        // Set appropriate status code
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json(errorResponse);
        
        // Clean up on error
        if (fs.existsSync(outputFile)) {
            fs.unlink(outputFile, () => {});
        }
    }
});

app.post('/api/youtube-convert', youtubeDownloadLimiter, async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let outputFile;

    try {
        // Check if yt-dlp is installed
        const isYtDlpInstalled = await checkYtDlp();
        if (!isYtDlpInstalled) {
            throw new Error('yt-dlp is not installed');
        }

        console.log('Starting YouTube download for URL:', url);
        
        // Generate output filename
        outputFile = path.join(tempDir, `${generateTempFilename()}.mp3`);

        // Download and convert using yt-dlp
        const ytdlp = spawn('yt-dlp', [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',  // Best quality
            '--embed-metadata',      // Include video metadata
            '--no-playlist',         // Single video only
            '--output', outputFile,
            url
        ]);

        let errorOutput = '';
        ytdlp.stderr.on('data', (data) => {
            errorOutput += data;
            console.log('yt-dlp progress:', data.toString());
        });

        const exitCode = await new Promise((resolve) => {
            ytdlp.on('close', resolve);
        });

        if (exitCode !== 0) {
            throw new Error(errorOutput || 'Failed to download and convert video');
        }

        // Check if file exists and has size
        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Download produced no output file');
        }

        // Get metadata from the downloaded file
        const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(outputFile, (err, data) => {
                if (err) {
                    console.warn('Failed to read metadata:', err);
                    resolve({
                        title: 'Unknown Title',
                        artist: 'Unknown Artist'
                    });
                    return;
                }

                const tags = data.format.tags || {};
                resolve({
                    title: tags.title || 'Unknown Title',
                    artist: tags.artist || tags.ARTIST || 'Unknown Artist'
                });
            });
        });

        // Set proper headers with metadata
        const safeTitle = metadata.title.replace(/[^\w\s-]/g, '').trim();
        const safeArtist = metadata.artist.replace(/[^\w\s-]/g, '').trim();
        const filename = `${safeArtist} - ${safeTitle}.mp3`.substring(0, 200);

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Video-Title', metadata.title);
        res.setHeader('X-Video-Artist', metadata.artist);

        // Send the file
        res.sendFile(outputFile, (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            // Clean up the temp file after sending
            fs.unlink(outputFile, () => {});
        });

    } catch (error) {
        console.error('YouTube download error:', error);
        
        let errorResponse = {
            error: 'Download failed',
            type: 'download_error'
        };

        let statusCode = 500;

        if (error.message.includes('yt-dlp is not installed')) {
            errorResponse.error = 'Server configuration error: yt-dlp is not installed';
            errorResponse.type = 'server_config';
            statusCode = 503;
        } else if (error.message.includes('Private video')) {
            errorResponse.error = 'Video is private';
            errorResponse.type = 'private_video';
            statusCode = 403;
        } else if (error.message.includes('Video unavailable')) {
            errorResponse.error = 'Video is unavailable';
            errorResponse.type = 'video_unavailable';
            statusCode = 404;
        } else if (error.message.includes('copyright')) {
            errorResponse.error = 'Video is not available due to copyright restrictions';
            errorResponse.type = 'copyright_restriction';
            statusCode = 451;
        } else if (error.message.includes('Sign in')) {
            errorResponse.error = 'Video requires authentication';
            errorResponse.type = 'auth_required';
            statusCode = 401;
        }

        // Add debug details in development
        if (!isProduction) {
            errorResponse.details = error.message;
        }

        res.status(statusCode).json(errorResponse);
        
        // Clean up on error
        if (fs.existsSync(outputFile)) {
            fs.unlink(outputFile, () => {});
        }
    }
});

// Get YouTube video metadata
app.get('/api/youtube-metadata/:videoId', youtubeMetadataLimiter, async (req, res) => {
    const { videoId } = req.params;
    
    if (!videoId || videoId === 'unknown') {
        return res.status(400).json({ error: 'Valid video ID is required' });
    }

    try {
        // Check if yt-dlp is installed
        const isYtDlpInstalled = await checkYtDlp();
        if (!isYtDlpInstalled) {
            throw new Error('yt-dlp is not installed');
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        console.log('Attempting to fetch video info for:', url);

        // Get video metadata using yt-dlp
        const ytdlp = spawn('yt-dlp', [
            '--dump-json',
            '--no-playlist',
            url
        ]);

        let jsonData = '';
        let errorOutput = '';

        ytdlp.stdout.on('data', (data) => {
            jsonData += data;
        });

        ytdlp.stderr.on('data', (data) => {
            errorOutput += data;
        });

        const exitCode = await new Promise((resolve) => {
            ytdlp.on('close', resolve);
        });

        if (exitCode !== 0) {
            throw new Error(errorOutput || 'Failed to fetch video metadata');
        }

        const videoDetails = JSON.parse(jsonData);
        
        // Extract metadata
        const metadata = {
            title: videoDetails.title || 'Unknown Title',
            author: videoDetails.uploader || videoDetails.channel || 'Unknown Artist',
            duration: parseInt(videoDetails.duration) || 0,
            thumbnail: videoDetails.thumbnail || null,
            description: videoDetails.description || '',
            uploadDate: videoDetails.upload_date || null,
            viewCount: parseInt(videoDetails.view_count) || 0
        };

        res.json(metadata);

    } catch (error) {
        console.error('YouTube metadata error:', error);
        
        let errorMessage = 'Failed to fetch video metadata';
        let statusCode = 500;

        if (error.message.includes('yt-dlp is not installed')) {
            errorMessage = 'Server configuration error: yt-dlp is not installed';
            statusCode = 503;
        } else if (error.message.includes('Private video')) {
            errorMessage = 'Video is private';
            statusCode = 403;
        } else if (error.message.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable';
            statusCode = 404;
        } else if (error.message.includes('copyright')) {
            errorMessage = 'Video is not available due to copyright restrictions';
            statusCode = 451;
        }

        res.status(statusCode).json({ 
            error: errorMessage,
            details: isProduction ? undefined : error.message
        });
    }
});

// Proxy YouTube thumbnails
app.get('/api/proxy-thumbnail', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // Validate that it's a YouTube thumbnail URL
        if (!url.includes('ytimg.com')) {
            return res.status(400).json({ error: 'Not a valid YouTube thumbnail URL' });
        }

        console.log('Fetching thumbnail:', url);

        // Try different thumbnail formats
        const formats = [
            url,
            url.replace('/vi_webp/', '/vi/').replace('.webp', '.jpg'), // Try jpg version
            url.replace('maxresdefault', 'hqdefault') // Try lower resolution
        ];

        let response;
        let error;

        for (const format of formats) {
            try {
                console.log('Trying format:', format);
                response = await fetch(format, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });

                if (response.ok) {
                    console.log('Successfully fetched format:', format);
                    break;
                }
                
                console.log('Format failed with status:', response.status);
                error = new Error(`Failed to fetch thumbnail: ${response.status} ${response.statusText}`);
            } catch (e) {
                console.log('Format fetch error:', e.message);
                error = e;
            }
        }

        if (!response?.ok) {
            throw error || new Error('Failed to fetch thumbnail in any format');
        }

        // Get the image data as a buffer
        const imageBuffer = await response.arrayBuffer();
        
        // Set appropriate headers
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Content-Length', Buffer.byteLength(imageBuffer));
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        
        // Send the buffer
        res.send(Buffer.from(imageBuffer));

    } catch (error) {
        console.error('Thumbnail proxy error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to fetch thumbnail',
            details: isProduction ? undefined : error.message
        });
    }
});

// Proxy audio files (for direct audio URL handling)
app.post('/api/proxy-audio', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // Validate that it's an audio URL
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'];
        const isAudioUrl = audioExtensions.some(ext => url.toLowerCase().includes(ext)) || 
                          url.includes('audio') || 
                          url.includes('sound');

        if (!isAudioUrl) {
            return res.status(400).json({ error: 'URL does not appear to be an audio file' });
        }

        // Fetch the audio file
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('audio/')) {
            throw new Error('URL does not return an audio file');
        }

        // Set appropriate headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', response.headers.get('content-length') || '');
        
        // Stream the audio data
        response.body.pipe(res);

    } catch (error) {
        console.error('Audio proxy error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to fetch audio file',
            details: isProduction ? undefined : error.message
        });
    }
});

// Generate song metadata using free LLM service
app.post('/api/generate-song-metadata', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        // Construct a system prompt that encourages JSON response
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

        if (data.status !== 'success' && data.status !== 'succes') { // API has typo in success
            throw new Error(data.error || 'LLM API request failed');
        }

        // Try to extract JSON from the response
        let metadata = { title: 'Generated Music', author: 'AI Artist' };
        
        try {
            // Look for JSON in the response
            const jsonMatch = data.response.match(/\{[^}]*"title"[^}]*"author"[^}]*\}/i) || 
                             data.response.match(/\{[^}]*"author"[^}]*"title"[^}]*\}/i);
            
            if (jsonMatch) {
                const parsedJson = JSON.parse(jsonMatch[0]);
                if (parsedJson.title && parsedJson.author) {
                    metadata.title = parsedJson.title.trim();
                    metadata.author = parsedJson.author.trim();
                }
            } else {
                // Fallback: try to parse the entire response as JSON
                const parsedResponse = JSON.parse(data.response);
                if (parsedResponse.title && parsedResponse.author) {
                    metadata.title = parsedResponse.title.trim();
                    metadata.author = parsedResponse.author.trim();
                }
            }
        } catch (parseError) {
            // If JSON parsing fails, try regex extraction
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
        // Create image prompt based on music description
        const imagePrompt = `Album cover art for: ${prompt}. Artistic, vibrant, music-themed design`;
        
        // Generate random seed between 1-100
        const seed = Math.floor(Math.random() * 100) + 1;
        
        // Build the API URL with fixed parameters
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

        // Get the image data
        const imageBuffer = await response.arrayBuffer();
        
        if (!imageBuffer || imageBuffer.byteLength === 0) {
            throw new Error('Image generation produced no data');
        }

        console.log(`Generated cover image size: ${imageBuffer.byteLength} bytes`);

        // Set proper headers for JPEG image
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', imageBuffer.byteLength);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

        // Send the image data
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
    
    // Don't expose error details in production
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