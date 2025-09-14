const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const NodeID3 = require('node-id3');

// Helper to generate safe temporary filenames
function generateTempFilename() {
    return crypto.randomBytes(16).toString('hex');
}

// Create temp directory if it doesn't exist
const tempDir = path.join('/tmp', 'music-player');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
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

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event, context) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    const { path: requestPath, httpMethod, body, queryStringParameters } = event;
    
    try {
        // Parse the path to determine which endpoint to call
        const pathParts = requestPath.split('/').filter(Boolean);
        const endpoint = pathParts[pathParts.length - 1];
        
        switch (endpoint) {
            case 'youtube-convert':
                if (httpMethod === 'POST') {
                    return await handleYouTubeConvert(JSON.parse(body || '{}'));
                }
                break;
                
            case 'youtube-metadata':
                if (httpMethod === 'GET') {
                    const videoId = pathParts[pathParts.length - 2];
                    return await handleYouTubeMetadata(videoId);
                }
                break;
                
            case 'proxy-audio':
                if (httpMethod === 'POST') {
                    return await handleProxyAudio(JSON.parse(body || '{}'));
                }
                break;
                
            case 'generate-music':
                if (httpMethod === 'POST') {
                    return await handleGenerateMusic(JSON.parse(body || '{}'));
                }
                break;
                
            case 'generate-song-metadata':
                if (httpMethod === 'POST') {
                    return await handleGenerateSongMetadata(JSON.parse(body || '{}'));
                }
                break;
                
            case 'generate-cover-image':
                if (httpMethod === 'POST') {
                    return await handleGenerateCoverImage(JSON.parse(body || '{}'));
                }
                break;
                
            default:
                return {
                    statusCode: 404,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Endpoint not found' })
                };
        }
        
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
        
    } catch (error) {
        console.error('API Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};

// YouTube conversion handler
async function handleYouTubeConvert({ url, videoId, metadata }) {
    if (!url) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'URL is required' })
        };
    }

    const outputFile = path.join(tempDir, `${generateTempFilename()}.mp3`);

    try {
        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }

        // Get video metadata using ytdl-core
        console.log('Fetching video metadata...');
        const info = await ytdl.getInfo(url);
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

        // Get the best audio stream
        const audioStream = ytdl(url, { 
            quality: 'highestaudio',
            filter: 'audioonly'
        });

        // Convert to MP3 with ffmpeg and add ID3 tags
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

        // Check if file exists and has size
        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Conversion produced no output file');
        }

        // Add ID3 tags to the MP3 file
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

        // Read the file and return it
        const fileBuffer = fs.readFileSync(outputFile);
        const safeTitle = extractedMetadata.title.replace(/[^\w\s-]/g, '').trim();
        const safeArtist = extractedMetadata.artist.replace(/[^\w\s-]/g, '').trim();
        const filename = `${safeArtist} - ${safeTitle}.mp3`.substring(0, 200);

        // Clean up the temp file
        fs.unlinkSync(outputFile);

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'audio/mpeg',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'X-Video-Title': extractedMetadata.title,
                'X-Video-Artist': extractedMetadata.artist,
                'Content-Length': fileBuffer.length.toString()
            },
            body: fileBuffer.toString('base64'),
            isBase64Encoded: true
        };

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

        // Clean up on error
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
        }

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
}

// YouTube metadata handler
async function handleYouTubeMetadata(videoId) {
    if (!videoId || videoId === 'unknown') {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Valid video ID is required' })
        };
    }

    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Validate URL
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }

        // Get video info
        const info = await ytdl.getInfo(url);
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

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(metadata)
        };

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

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
}

// Proxy audio handler
async function handleProxyAudio({ url }) {
    if (!url) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'URL is required' })
        };
    }

    try {
        // Validate that it's an audio URL
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'];
        const isAudioUrl = audioExtensions.some(ext => url.toLowerCase().includes(ext)) || 
                          url.includes('audio') || 
                          url.includes('sound');

        if (!isAudioUrl) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'URL does not appear to be an audio file' })
            };
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

        const audioBuffer = await response.arrayBuffer();

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType,
                'Content-Length': audioBuffer.byteLength.toString()
            },
            body: Buffer.from(audioBuffer).toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Audio proxy error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: error.message || 'Failed to fetch audio file',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
}

// Music generation handler (simplified for Netlify)
async function handleGenerateMusic({ prompt, length = 10000, apiKey }) {
    return {
        statusCode: 501,
        headers: corsHeaders,
        body: JSON.stringify({ 
            error: 'Music generation not available in serverless environment',
            message: 'This feature requires a full server environment with persistent storage'
        })
    };
}

// Song metadata generation handler
async function handleGenerateSongMetadata({ prompt }) {
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
            return {
                statusCode: 429,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: data.error || 'Rate limit exceeded',
                    retry_after: data.retry_after || 5
                })
            };
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

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(metadata)
        };

    } catch (error) {
        console.error('LLM metadata generation error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: 'Failed to generate song metadata',
                fallback: { title: 'Generated Music', author: 'AI Artist' }
            })
        };
    }
}

// Cover image generation handler
async function handleGenerateCoverImage({ prompt }) {
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

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'image/jpeg',
                'Content-Length': imageBuffer.byteLength.toString(),
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: Buffer.from(imageBuffer).toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Cover image generation error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: 'Failed to generate cover image',
                message: error.message || 'Image generation failed'
            })
        };
    }
}
