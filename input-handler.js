// Input handling functionality
class InputHandler {
    constructor() {
        this.addSongButton = document.querySelector('.add-song');
        this.addSongInput = document.querySelector('.add-song-input');
        // Don't set up event listeners automatically - they're handled by the main script now
        // this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.addSongButton || !this.addSongInput) return;

        this.addSongButton.addEventListener('click', () => this.handleButtonClick());
        this.addSongInput.addEventListener('blur', () => this.handleInputBlur());
        this.addSongInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    handleButtonClick() {
        if (!this.addSongButton.classList.contains('input-mode')) {
            this.addSongButton.classList.add('input-mode');
            this.addSongInput.focus();
        }
    }

    handleInputBlur() {
        if (!this.addSongInput.value.trim()) {
            this.addSongButton.classList.remove('input-mode');
        }
    }

    async handleKeyDown(e) {
        if (e.key === 'Enter' && this.addSongInput.value.trim()) {
            const url = this.addSongInput.value.trim();
            this.addSongInput.value = '';
            this.addSongButton.classList.remove('input-mode');

            try {
                if (this.isYouTubeUrl(url)) {
                    await this.handleYouTubeUrl(url);
                } else {
                    await this.handleDirectAudioUrl(url);
                }
            } catch (error) {
                console.error('Error processing URL:', error);
                if (window.errorHandler) {
                    window.errorHandler.showError('Failed to process the URL. Please make sure it\'s a valid audio file link.', {
                        title: 'URL Processing Failed',
                        duration: 6000
                    });
                } else {
                    alert('Failed to process the URL. Please make sure it\'s a valid audio file link.');
                }
            }
        } else if (e.key === 'Escape') {
            this.addSongInput.value = '';
            this.addSongButton.classList.remove('input-mode');
        }
    }

    isYouTubeUrl(url) {
        return url.includes('youtube.com') || url.includes('youtu.be');
    }

    async handleYouTubeUrl(url) {
        try {
            const loadingIndicator = document.querySelector('.loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.classList.add('active');
            }

            // Extract video ID and get metadata
            const videoId = this.extractYouTubeVideoId(url);
            console.log('Extracted video ID:', videoId);

            // Get the API base URL based on environment
            const apiBaseUrl = this.getApiBaseUrl();
            
            const metadata = await this.fetchYouTubeMetadata(videoId, apiBaseUrl);
            console.log('Fetched metadata:', metadata);

            let filename;
            if (metadata && metadata.title && metadata.author) {
                const safeFileName = this.sanitizeFileName(`${metadata.author} - ${metadata.title}`);
                filename = `${safeFileName}.mp3`;
                console.log('Using metadata filename:', filename);
            } else {
                filename = `youtube-${videoId}.mp3`;
                console.log('Falling back to video ID filename:', filename);
            }

            // Make request to our backend conversion service
            const response = await fetch(`${apiBaseUrl}/youtube-convert`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    url,
                    videoId,
                    metadata: metadata || {} // Pass metadata to backend
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `YouTube conversion failed with status ${response.status}`);
            }

            const blob = await response.blob();
            if (!blob.type.startsWith('audio/')) {
                throw new Error('Invalid audio file received');
            }

            // Get filename from response headers if available
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            const file = new File([blob], filename, { type: blob.type });
            console.log('Created file with name:', file.name);
            
            // Pass metadata so we keep title/artist when container has no tags
            await window.processAudioFile(file, metadata || undefined);
            
            // Show success message
            if (window.errorHandler) {
                const title = metadata?.title || 'YouTube Video';
                window.errorHandler.showSuccess(`"${title}" has been added to your collection!`, {
                    duration: 5000
                });
            }

        } catch (error) {
            console.error('YouTube conversion error:', error);
            if (window.errorHandler) {
                window.errorHandler.showError(error.message || 'Failed to convert YouTube video. Please try again later.', {
                    title: 'YouTube Conversion Failed',
                    duration: 6000
                });
            } else {
                alert(error.message || 'Failed to convert YouTube video. Please try again later.');
            }
        } finally {
            const loadingIndicator = document.querySelector('.loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.classList.remove('active');
            }
        }
    }

    getApiBaseUrl() {
        // Use Render.com server in production, local in development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3000';
        } else {
            // Production server on Render.com
            return 'https://disc-player.onrender.com';
        }
    }

    async fetchYouTubeMetadata(videoId, apiBaseUrl) {
        try {
            console.log('Fetching metadata for video ID:', videoId);
            const response = await fetch(`${apiBaseUrl}/youtube-metadata/${videoId}`);
            
            if (!response.ok) {
                console.error('Metadata fetch failed with status:', response.status);
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to fetch video metadata');
            }

            const data = await response.json();
            console.log('Received metadata:', data);

            if (!data || !data.title || !data.author) {
                console.error('Invalid metadata format received:', data);
                throw new Error('Invalid metadata format');
            }

            return data;
        } catch (error) {
            console.error('Error fetching YouTube metadata:', error);
            return null;
        }
    }

    sanitizeFileName(name) {
        // Remove invalid filename characters and trim
        return name.replace(/[<>:"/\\|?*]/g, '-')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .substring(0, 200); // Limit length to avoid too long filenames
    }

    async handleDirectAudioUrl(url) {
        try {
            // Get the API base URL based on environment
            const apiBaseUrl = this.getApiBaseUrl();
            
            // Instead of fetching directly, go through your backend proxy
            const response = await fetch(`${apiBaseUrl}/proxy-audio`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to fetch audio');
            }
            
            const blob = await response.blob();
            if (!blob.type.startsWith('audio/')) {
                throw new Error('Not a valid audio file');
            }

            const filename = url.split('/').pop() || 'audio';
            const file = new File([blob], filename, { type: blob.type });
            await window.processAudioFile(file);
            
            // Show success message
            if (window.errorHandler) {
                window.errorHandler.showSuccess(`"${filename}" has been added to your collection!`, {
                    duration: 5000
                });
            }
        } catch (error) {
            console.error('Error fetching audio:', error);
            throw error;
        }
    }

    extractYouTubeVideoId(url) {
        let videoId = '';
        const pattern = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(pattern);
        if (match && match[1]) {
            videoId = match[1];
        }
        return videoId || 'unknown';
    }
}

// Export the class
export default InputHandler; 