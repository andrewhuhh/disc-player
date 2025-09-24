// Netlify Function: generate-cover-image.js
// Generates album cover art using Pollinations text-to-image API

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
        const { prompt } = JSON.parse(event.body);

        // Validate required parameters
        if (!prompt) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Prompt is required' })
            };
        }

        // Create enhanced prompt for better album art
        const imagePrompt = `Album cover art for: ${prompt}. Artistic, vibrant, music-themed design`;
        
        // Generate random seed for variety
        const seed = Math.floor(Math.random() * 100) + 1;
        
        // Build Pollinations API URL with parameters
        const apiUrl = new URL('https://image.pollinations.ai/prompt/' + encodeURIComponent(imagePrompt));
        apiUrl.searchParams.set('model', 'flux');
        apiUrl.searchParams.set('width', '240');
        apiUrl.searchParams.set('height', '240');
        apiUrl.searchParams.set('seed', seed.toString());
        apiUrl.searchParams.set('nologo', 'true');

        console.log('Generating cover image with URL:', apiUrl.toString());
        console.log('Image prompt:', imagePrompt);
        console.log('Seed:', seed);

        // Fetch image from Pollinations API
        const response = await fetch(apiUrl.toString());

        if (!response.ok) {
            throw new Error(`Image generation failed with status ${response.status}`);
        }

        // Get image as array buffer
        const imageBuffer = await response.arrayBuffer();
        
        if (!imageBuffer || imageBuffer.byteLength === 0) {
            throw new Error('Image generation produced no data');
        }

        console.log(`Generated cover image size: ${imageBuffer.byteLength} bytes`);

        // Convert to base64 for response
        const base64Image = Buffer.from(imageBuffer).toString('base64');

        // Return image data as base64
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'public, max-age=3600'
            },
            body: base64Image,
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('Cover image generation error:', error);
        
        // Build error response
        const errorResponse = {
            error: 'Failed to generate cover image',
            message: error.message || 'Image generation failed'
        };

        // Check for specific error types
        if (error.message && error.message.includes('timeout')) {
            errorResponse.error = 'Image generation timed out';
            errorResponse.message = 'The image generation service is taking too long to respond. Please try again.';
        } else if (error.message && error.message.includes('network')) {
            errorResponse.error = 'Network error';
            errorResponse.message = 'Could not connect to the image generation service. Please check your connection.';
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify(errorResponse)
        };
    }
};