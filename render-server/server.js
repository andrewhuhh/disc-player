require('dotenv').config();
const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const rateLimit = require('express-rate-limit');

// Optional dependencies
let ffmpeg;
try {
    ffmpeg = require('fluent-ffmpeg');
} catch (err) {
    console.log('Optional dependency fluent-ffmpeg not available, some features may be limited');
}

const app = express();
const port = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

// Common YouTube request options
const YOUTUBE_REQUEST_OPTIONS = {
    requestOptions: {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': '2.20230912.00.00'
        }
    }
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(limiter);

// Root route for basic info
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        service: 'Record Player API',
        version: '1.0.0',
        endpoints: ['/youtube-metadata/:videoId', '/youtube-convert', '/health']
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// YouTube metadata endpoint
app.get('/youtube-metadata/:videoId', async (req, res) => {
    const { videoId } = req.params;
    
    if (!videoId) {
        return res.status(400).json({ error: 'Video ID is required' });
    }

    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(url, YOUTUBE_REQUEST_OPTIONS);
        const videoDetails = info.videoDetails;
        
        res.json({
            title: videoDetails.title || 'Unknown Title',
            author: videoDetails.author?.name || 'Unknown Artist',
            duration: parseInt(videoDetails.lengthSeconds) || 0,
            thumbnail: videoDetails.thumbnails?.[0]?.url || null,
            description: videoDetails.description || '',
            uploadDate: videoDetails.uploadDate || null,
            viewCount: parseInt(videoDetails.viewCount) || 0
        });

    } catch (error) {
        console.error('YouTube metadata error:', error);
        
        let statusCode = 500;
        let message = 'Failed to fetch video metadata';

        if (error.message.includes('Video unavailable')) {
            message = 'Video is unavailable or private';
            statusCode = 404;
        } else if (error.message.includes('age-restricted')) {
            message = 'Video is age-restricted';
            statusCode = 403;
        } else if (error.message.includes('region')) {
            message = 'Video is not available in your region';
            statusCode = 451;
        }

        res.status(statusCode).json({ error: message });
    }
});

// YouTube conversion endpoint
app.post('/youtube-convert', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        const info = await ytdl.getInfo(url, YOUTUBE_REQUEST_OPTIONS);
        const videoDetails = info.videoDetails;
        
        // Choose best audio format
        const format = ytdl.chooseFormat(info.formats, { 
            quality: 'highestaudio',
            filter: 'audioonly'
        });

        // Set up headers for streaming
        res.setHeader('Content-Type', format.mimeType || 'audio/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${videoDetails.title}.${format.container}"`);
        res.setHeader('X-Video-Title', videoDetails.title);
        res.setHeader('X-Video-Artist', videoDetails.author?.name || 'Unknown Artist');

        // Stream the audio
        const audioStream = ytdl(url, { 
            format,
            ...YOUTUBE_REQUEST_OPTIONS
        });

        audioStream.pipe(res);

        audioStream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Streaming failed' });
            }
        });

    } catch (error) {
        console.error('YouTube conversion error:', error);
        
        let statusCode = 500;
        let message = 'Conversion failed';

        if (error.message.includes('Video unavailable')) {
            message = 'Video is unavailable or private';
            statusCode = 404;
        } else if (error.message.includes('age-restricted')) {
            message = 'Video is age-restricted';
            statusCode = 403;
        } else if (error.message.includes('region')) {
            message = 'Video is not available in your region';
            statusCode = 451;
        }

        res.status(statusCode).json({ error: message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    console.log('404 Not Found:', req.method, req.url);
    res.status(404).json({ 
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.url}`,
        status: 404
    });
});

// Start server
app.listen(port, () => {
    console.log('='.repeat(50));
    console.log(`Record Player API Server`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Port: ${port}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Node Version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    console.log('Available routes:');
    console.log('- GET  /');
    console.log('- GET  /health');
    console.log('- GET  /youtube-metadata/:videoId');
    console.log('- POST /youtube-convert');
    console.log('='.repeat(50));
});
