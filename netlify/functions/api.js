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

    const { path: requestPath, httpMethod, body } = event;
    
    try {
        // Parse the path to determine which endpoint to call
        const pathParts = requestPath.split('/').filter(Boolean);
        const apiIndex = pathParts.findIndex((p) => p === 'api');
        const routeParts = apiIndex >= 0 ? pathParts.slice(apiIndex + 1) : pathParts;
        const endpoint = routeParts[0];
        
        switch (endpoint) {
            case 'health':
                if (httpMethod === 'GET') {
                    return {
                        statusCode: 200,
                        headers: corsHeaders,
                        body: JSON.stringify({ 
                            status: 'ok', 
                            timestamp: new Date().toISOString(),
                            environment: process.env.NODE_ENV || 'development'
                        })
                    };
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