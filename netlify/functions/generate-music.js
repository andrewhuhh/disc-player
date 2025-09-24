// Netlify Function: generate-music.js
// Proxies music generation requests to ElevenLabs API

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

exports.handler = async (event, context) => {
    // CORS headers for all responses
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Parse request body
        const { prompt, length = 10000, apiKey } = JSON.parse(event.body);

        // Validate required parameters
        if (!prompt) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Prompt is required' })
            };
        }

        if (!apiKey) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ElevenLabs API key is required' })
            };
        }

        // Initialize ElevenLabs client
        const elevenlabs = new ElevenLabsClient({
            apiKey: apiKey,
        });

        console.log('Generating music with prompt:', prompt);
        console.log('Music length:', length, 'ms');

        // Generate music using ElevenLabs API
        const track = await elevenlabs.music.compose({
            prompt: prompt,
            musicLengthMs: parseInt(length),
        });

        console.log('ElevenLabs API Response Type:', typeof track);

        let audioData;
        
        // Handle ReadableStream response (Node.js environment)
        if (track && typeof track === 'object' && track.getReader) {
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
            
            // Combine all chunks into a single Uint8Array
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            audioData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }
            
            console.log(`Final audio data size: ${audioData.length} bytes`);
        } else if (track && track[Symbol.asyncIterator]) {
            // Handle async iterable (alternative stream format)
            console.log('Converting async iterable to audio data...');
            const chunks = [];
            for await (const chunk of track) {
                chunks.push(chunk);
            }
            
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            audioData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }
            
            console.log(`Final audio data size: ${audioData.length} bytes`);
        } else {
            // Handle direct data response
            console.log('Track is not a stream, using as-is');
            audioData = track;
            console.log(`Audio data type: ${typeof audioData}`);
            console.log(`Audio data length: ${audioData?.length || 'unknown'}`);
        }

        // Validate audio data
        if (!audioData || audioData.length === 0) {
            throw new Error('Music generation produced no audio data');
        }

        // Convert to base64 for response (Netlify Functions have size limits for binary data)
        const audioBuffer = Buffer.from(audioData);
        const base64Audio = audioBuffer.toString('base64');

        console.log('Successfully generated audio, size:', audioBuffer.length, 'bytes');

        // Return audio data as base64
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'audio/mpeg',
                'Content-Disposition': 'attachment; filename="generated-music.mp3"'
            },
            body: base64Audio,
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Music generation error:', error);
        
        // Build error response with details
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
        
        // Map error status codes appropriately
        let statusCode = 500;
        if (error.statusCode === 401) {
            statusCode = 401;
            errorResponse.error = 'Invalid API key';
            errorResponse.type = 'auth_error';
        } else if (error.statusCode === 429) {
            statusCode = 429;
            errorResponse.error = 'Rate limit exceeded';
            errorResponse.type = 'rate_limit';
        } else if (error.statusCode === 400) {
            statusCode = 400;
            errorResponse.type = 'validation_error';
        } else if (error.statusCode) {
            statusCode = error.statusCode;
        }
        
        return {
            statusCode,
            headers,
            body: JSON.stringify(errorResponse)
        };
    }
};