const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
require('dotenv').config();

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

// Configure CORS based on environment
const corsOptions = {
    origin: isProduction 
        ? ['https://myrecordplayer.netlify.app']
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
};
app.use(cors(corsOptions));

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

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

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

app.post('/api/youtube-convert', async (req, res) => {
    const { url, videoId, metadata } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let outputFile;

    try {
        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }

        // Get video metadata using ytdl-core
        console.log('Fetching video metadata...');
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                    'accept-language': 'en-US,en;q=0.9'
                }
            }
        });
        const videoDetails = info.videoDetails;
        
        // Extract metadata
        const extractedMetadata = {
            title: videoDetails.title || 'Unknown Title',
            artist: videoDetails.author?.name || 'Unknown Artist',
            album: videoDetails.media?.category || 'YouTube',
            year: videoDetails.uploadDate ? videoDetails.uploadDate.split('-')[0] : new Date().getFullYear().toString(),
            duration: parseInt(videoDetails.lengthSeconds) || 0
        };

        console.log('Extracted metadata:', extractedMetadata);

        // Choose best audio-only format to set accurate headers/extension
        const selectedFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
        const container = selectedFormat?.container || '';
        const codecs = selectedFormat?.codecs || '';
        const isWebm = container === 'webm' || /opus/i.test(codecs);
        const contentType = isWebm ? 'audio/webm' : 'audio/mp4';
        const fileExtension = isWebm ? 'webm' : 'm4a';

        // Determine output file path based on availability of ffmpeg
        outputFile = path.join(tempDir, `${generateTempFilename()}.${(ffmpeg && ffmpegPath) ? 'mp3' : fileExtension}`);

        // Get the best audio stream
        const audioStream = ytdl(url, { 
            quality: 'highestaudio',
            filter: 'audioonly',
            requestOptions: {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                    'accept-language': 'en-US,en;q=0.9'
                }
            }
        });

        // Convert to MP3 with ffmpeg and add ID3 tags
        if (ffmpeg && ffmpegPath) {
            await new Promise((resolve, reject) => {
                ffmpeg(audioStream)
                    .setFfmpegPath(ffmpegPath)
                    .audioBitrate(128)
                    .audioChannels(2)
                    .audioFrequency(44100)
                    .toFormat('mp3')
                    .on('error', (err) => {
                        console.error('FFmpeg error:', err);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('Audio conversion completed');
                        resolve();
                    })
                    .save(outputFile);
            });
        } else {
            // Fallback: stream audio directly without conversion
            const chunks = [];
            for await (const chunk of audioStream) {
                chunks.push(chunk);
            }
            const audioBuffer = Buffer.concat(chunks);
            fs.writeFileSync(outputFile, audioBuffer);
        }

        // Check if file exists and has size
        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Conversion produced no output file');
        }

        // Add ID3 tags to the MP3 file
        if (NodeID3 && outputFile.endsWith('.mp3')) {
            try {
                const id3Tags = {
                    title: extractedMetadata.title,
                    artist: extractedMetadata.artist,
                    album: extractedMetadata.album,
                    year: extractedMetadata.year,
                    genre: 'YouTube'
                };

                console.log('Adding ID3 tags:', id3Tags);
                NodeID3.update(id3Tags, outputFile);
                console.log('ID3 tags added successfully');
            } catch (tagError) {
                console.warn('Failed to add ID3 tags:', tagError);
                // Continue without tags rather than failing
            }
        } else {
            console.log('ID3 tagging not available - skipping metadata tags');
        }

        // Set proper headers with metadata
        const safeTitle = extractedMetadata.title.replace(/[^\w\s-]/g, '').trim();
        const safeArtist = extractedMetadata.artist.replace(/[^\w\s-]/g, '').trim();
        const filename = `${safeArtist} - ${safeTitle}.${outputFile.endsWith('.mp3') ? 'mp3' : fileExtension}`.substring(0, 200);

        res.setHeader('Content-Type', outputFile.endsWith('.mp3') ? 'audio/mpeg' : contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Video-Title', extractedMetadata.title);
        res.setHeader('X-Video-Artist', extractedMetadata.artist);

        // Send the file
        res.sendFile(outputFile, (err) => {
            if (err) {
                console.error('Error sending file:', err);
            }
            // Clean up the temp file after sending
            fs.unlink(outputFile, () => {});
        });

    } catch (error) {
        console.error('YouTube conversion error:', error);
        
        // Provide more specific error messages
        let errorMessage = 'Conversion failed';
        if (error.message.includes('Invalid YouTube URL')) {
            errorMessage = 'Invalid YouTube URL provided';
        } else if (error.message.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
        } else if (error.message.includes('age-restricted')) {
            errorMessage = 'Video is age-restricted and cannot be downloaded';
        } else if (error.message.includes('region')) {
            errorMessage = 'Video is not available in your region';
        }

        res.status(500).json({ 
            error: errorMessage,
            details: isProduction ? undefined : error.message
        });
        
        // Clean up on error
        if (fs.existsSync(outputFile)) {
            fs.unlink(outputFile, () => {});
        }
    }
});

// Get YouTube video metadata
app.get('/api/youtube-metadata/:videoId', async (req, res) => {
    const { videoId } = req.params;
    
    if (!videoId || videoId === 'unknown') {
        return res.status(400).json({ error: 'Valid video ID is required' });
    }

    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Validate URL
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }

        // Get video info with request headers
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                    'accept-language': 'en-US,en;q=0.9'
                }
            }
        });
        const videoDetails = info.videoDetails;
        
        // Extract metadata
        const metadata = {
            title: videoDetails.title || 'Unknown Title',
            author: videoDetails.author?.name || 'Unknown Artist',
            duration: parseInt(videoDetails.lengthSeconds) || 0,
            thumbnail: videoDetails.thumbnails?.[0]?.url || null,
            description: videoDetails.description || '',
            uploadDate: videoDetails.uploadDate || null,
            viewCount: parseInt(videoDetails.viewCount) || 0
        };

        res.json(metadata);

    } catch (error) {
        console.error('YouTube metadata error:', error);
        
        let errorMessage = 'Failed to fetch video metadata';
        if (error.message.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable or private';
        } else if (error.message.includes('age-restricted')) {
            errorMessage = 'Video is age-restricted';
        } else if (error.message.includes('region')) {
            errorMessage = 'Video is not available in your region';
        }

        res.status(500).json({ 
            error: errorMessage,
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