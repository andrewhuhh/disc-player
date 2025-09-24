// Netlify Function: generate-song-metadata.js
// Generates creative song titles and artist names using a free LLM API

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

        // Prepare system prompt for LLM
        const systemPrompt = `Based on this music description, generate a creative song title and artist name. Return ONLY a JSON object with "title" and "author" fields, nothing else. Make the title catchy and the artist name creative but believable. Music description: "${prompt}"`;

        console.log('Generating metadata for prompt:', prompt);

        // Call free LLM API
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
        console.log('LLM API Response:', data);
        
        // Handle rate limiting
        if (data.status === 'rate_limited') {
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ 
                    error: data.error || 'Rate limit exceeded',
                    retry_after: data.retry_after || 5,
                    fallback: { title: 'Generated Music', author: 'AI Artist' }
                })
            };
        }

        // Check for success status (handle typo in API response)
        if (data.status !== 'success' && data.status !== 'succes') {
            throw new Error(data.error || 'LLM API request failed');
        }

        // Default metadata
        let metadata = { title: 'Generated Music', author: 'AI Artist' };
        
        try {
            // Try to extract JSON from response
            // First attempt: find JSON object pattern
            const jsonMatch = data.response.match(/\{[^}]*"title"[^}]*"author"[^}]*\}/i) || 
                             data.response.match(/\{[^}]*"author"[^}]*"title"[^}]*\}/i);
            
            if (jsonMatch) {
                const parsedJson = JSON.parse(jsonMatch[0]);
                if (parsedJson.title && parsedJson.author) {
                    metadata.title = parsedJson.title.trim();
                    metadata.author = parsedJson.author.trim();
                    console.log('Extracted metadata from JSON match:', metadata);
                }
            } else {
                // Second attempt: parse entire response as JSON
                const parsedResponse = JSON.parse(data.response);
                if (parsedResponse.title && parsedResponse.author) {
                    metadata.title = parsedResponse.title.trim();
                    metadata.author = parsedResponse.author.trim();
                    console.log('Extracted metadata from parsed response:', metadata);
                }
            }
        } catch (parseError) {
            console.log('JSON parsing failed, attempting regex extraction');
            
            // Fallback: use regex to extract title and author
            const titleMatch = data.response.match(/"?title"?\s*:?\s*"?([^",\n]+)"?/i);
            const authorMatch = data.response.match(/"?author"?\s*:?\s*"?([^",\n]+)"?/i) ||
                              data.response.match(/"?artist"?\s*:?\s*"?([^",\n]+)"?/i);
            
            if (titleMatch) {
                metadata.title = titleMatch[1].trim().replace(/['"]/g, '');
                console.log('Extracted title via regex:', metadata.title);
            }
            if (authorMatch) {
                metadata.author = authorMatch[1].trim().replace(/['"]/g, '');
                console.log('Extracted author via regex:', metadata.author);
            }
        }

        // Clean up metadata values
        metadata.title = metadata.title.replace(/^\s*["']|["']\s*$/g, '').trim();
        metadata.author = metadata.author.replace(/^\s*["']|["']\s*$/g, '').trim();

        console.log('Final metadata:', metadata);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(metadata)
        };

    } catch (error) {
        console.error('LLM metadata generation error:', error);
        
        // Return fallback metadata with error
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to generate song metadata',
                message: error.message,
                fallback: { title: 'Generated Music', author: 'AI Artist' }
            })
        };
    }
};