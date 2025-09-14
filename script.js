// Initialize IndexedDB
const dbName = 'musicPlayerDB';
const dbVersion = 2; // Increased version number to force upgrade
let db;

// Audio Context and Analyzer setup
let audioContext;
let audioSource;
let analyzer;
const FFT_SIZE = 256;
let dataArray;
let canvas;
let canvasCtx;

// Audio analysis variables (simplified for basic bar visualizer)

// Error Handling System
class ErrorHandler {
    constructor() {
        this.container = document.getElementById('error-toast-container');
        this.activeToasts = new Set();
    }

    showError(error, options = {}) {
        const {
            title = 'Error',
            message = 'An unexpected error occurred',
            type = 'error',
            duration = 8000,
            actions = [],
            showClose = true
        } = options;

        // Parse error message for better user experience
        const parsedError = this.parseError(error);
        
        // If parseError returns null, skip showing the toast (likely null/undefined error)
        if (!parsedError) {
            console.log('Skipping error toast for null/undefined error');
            return null;
        }
        
        const finalMessage = parsedError.message || message;
        const finalTitle = parsedError.title || title;

        const toast = this.createToast({
            title: finalTitle,
            message: finalMessage,
            type: parsedError.type || type,
            duration,
            actions,
            showClose
        });

        this.container.appendChild(toast);
        this.activeToasts.add(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.hideToast(toast);
            }, duration);
        }

        return toast;
    }

    showSuccess(message, options = {}) {
        return this.showError(null, {
            title: 'Success',
            message,
            type: 'success',
            duration: 4000,
            ...options
        });
    }

    showWarning(message, options = {}) {
        return this.showError(null, {
            title: 'Warning',
            message,
            type: 'warning',
            duration: 6000,
            ...options
        });
    }

    parseError(error) {
        if (!error) {
            // Log this case to help debug when null/undefined errors are passed
            console.warn('ErrorHandler.parseError called with null/undefined error');
            return null; // Return null to indicate we should skip showing a toast
        }

        // Handle different error types
        if (typeof error === 'string') {
            return { message: error, type: 'error' };
        }

        if (error instanceof Error) {
            const message = error.message;
            
            // ElevenLabs API specific error parsing
            if (message.includes('Status code: 402')) {
                return {
                    title: 'Upgrade Required',
                    message: 'The Music API requires a paid ElevenLabs plan. Please upgrade your account to generate music.',
                    type: 'warning',
                    actions: [
                        {
                            text: 'Upgrade Account',
                            action: () => window.open('https://elevenlabs.io/pricing', '_blank')
                        }
                    ]
                };
            }

            if (message.includes('Status code: 401') || message.includes('unauthorized')) {
                return {
                    title: 'Invalid API Key',
                    message: 'Please check your ElevenLabs API key and try again.',
                    type: 'error',
                    actions: [
                        {
                            text: 'Get API Key',
                            action: () => window.open('https://elevenlabs.io/app/developers/api-keys', '_blank')
                        }
                    ]
                };
            }

            if (message.includes('Status code: 403') || message.includes('forbidden')) {
                return {
                    title: 'Access Denied',
                    message: 'Your ElevenLabs account doesn\'t have access to the Music API.',
                    type: 'error'
                };
            }

            if (message.includes('Status code: 400')) {
                return {
                    title: 'Invalid Request',
                    message: 'There was an issue with your request. Please check your prompt and try again.',
                    type: 'error'
                };
            }

            if (message.includes('Status code: 429')) {
                return {
                    title: 'Rate Limit Exceeded',
                    message: 'You\'ve hit the rate limit. Please wait a moment before trying again.',
                    type: 'warning'
                };
            }

            if (message.includes('Status code: 500')) {
                return {
                    title: 'Server Error',
                    message: 'ElevenLabs servers are experiencing issues. Please try again later.',
                    type: 'error'
                };
            }

            if (message.includes('NetworkError') || message.includes('Failed to fetch')) {
                return {
                    title: 'Connection Error',
                    message: 'Unable to connect to the server. Please check your internet connection.',
                    type: 'error'
                };
            }

            // Generic error parsing
            if (message.includes('Invalid API key')) {
                return {
                    title: 'Invalid API Key',
                    message: 'Please check your ElevenLabs API key and try again.',
                    type: 'error'
                };
            }

            // Handle ElevenLabs TOS violation messages
            if (message.includes('violated our Terms of Service') || message.includes('bad_prompt')) {
                return {
                    title: 'Content Policy Violation',
                    message: 'Your prompt appears to have violated our Terms of Service. Please try again with a different prompt.',
                    type: 'warning'
                };
            }

            if (message.includes('Rate limit exceeded')) {
                return {
                    title: 'Rate Limit Exceeded',
                    message: 'Please wait a moment before trying again.',
                    type: 'warning'
                };
            }

            return { message, type: 'error' };
        }

        // Handle response objects from server
        if (error.type) {
            let result = {
                message: error.message || error.error || 'An error occurred',
                type: error.type === 'api_error' ? 'error' : error.type
            };

            // Handle specific error types from server
            if (error.type === 'bad_prompt') {
                result.title = 'Content Policy Violation';
                result.message = 'Your prompt appears to have violated our Terms of Service. Please try again with a different prompt.';
                result.type = 'warning';
                
                // Add prompt suggestion if available
                if (error.promptSuggestion) {
                    result.actions = [
                        {
                            text: 'Use Suggested Prompt',
                            primary: true,
                            action: () => {
                                const musicPromptInput = document.getElementById('music-prompt');
                                if (musicPromptInput) {
                                    musicPromptInput.value = error.promptSuggestion;
                                    musicPromptInput.focus();
                                }
                            }
                        }
                    ];
                }
            } else if (error.type === 'limited_access') {
                result.title = 'Access Limited';
                result.type = 'warning';
            } else if (error.statusCode === 400) {
                result.title = 'Invalid Request';
                result.type = 'error';
            }

            return result;
        }

        // Legacy response object handling
        if (error.detail && error.detail.message) {
            return {
                message: error.detail.message,
                type: error.detail.status === 'limited_access' ? 'warning' : 'error'
            };
        }

        if (error.error) {
            return { message: error.error, type: 'error' };
        }

        return { message: 'An unexpected error occurred', type: 'error' };
    }

    createToast({ title, message, type, duration, actions, showClose }) {
        const toast = document.createElement('div');
        toast.className = `error-toast ${type}-toast`;

        const icon = this.getIcon(type);
        
        toast.innerHTML = `
            ${showClose ? '<button class="error-toast-close" aria-label="Close">&times;</button>' : ''}
            <div class="error-toast-header">
                <span class="error-toast-icon">${icon}</span>
                <span class="error-toast-title">${title}</span>
            </div>
            <div class="error-toast-message">${message}</div>
            ${actions.length > 0 ? `
                <div class="error-toast-actions">
                    ${actions.map(action => 
                        `<button class="error-toast-button ${action.primary ? 'primary' : ''}" data-action="${action.text}">${action.text}</button>`
                    ).join('')}
                </div>
            ` : ''}
        `;

        // Add event listeners
        if (showClose) {
            const closeBtn = toast.querySelector('.error-toast-close');
            closeBtn.addEventListener('click', () => this.hideToast(toast));
        }

        actions.forEach(action => {
            const btn = toast.querySelector(`[data-action="${action.text}"]`);
            if (btn) {
                btn.addEventListener('click', action.action);
            }
        });

        return toast;
    }

    getIcon(type) {
        const icons = {
            error: '⚠️',
            warning: '⚠️',
            success: '✅',
            info: 'ℹ️'
        };
        return icons[type] || icons.error;
    }

    hideToast(toast) {
        if (!toast || !this.activeToasts.has(toast)) return;

        toast.classList.add('hide');
        this.activeToasts.delete(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    clearAll() {
        this.activeToasts.forEach(toast => {
            this.hideToast(toast);
        });
    }
}

// Initialize error handler
const errorHandler = new ErrorHandler();

// Make errorHandler globally available
window.errorHandler = errorHandler;

// Global error handler for unhandled errors
window.addEventListener('error', (event) => {
    console.error('Unhandled error:', event.error);
    errorHandler.showError(event.error, {
        title: 'Unexpected Error',
        message: 'An unexpected error occurred. Please try again.',
        type: 'error',
        duration: 10000
    });
});

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    console.log('Event object:', event);
    console.log('Reason type:', typeof event.reason);
    console.log('Reason value:', event.reason);
    
    // Only show error toast for actual errors, not for expected cases like autoplay failures
    const reason = event.reason;
    if (reason && (
        (reason.message && reason.message.includes('play')) ||
        (typeof reason === 'string' && reason.includes('play'))
    )) {
        // Likely an autoplay failure, just log it and prevent default browser behavior
        console.warn('Suppressed autoplay-related promise rejection:', reason);
        event.preventDefault();
        return;
    }
    
    errorHandler.showError(event.reason, {
        title: 'Request Failed',
        message: 'A request failed unexpectedly. Please try again.',
        type: 'error',
        duration: 10000
    });
    event.preventDefault(); // Prevent the default browser behavior
});

// Helper function to extract text content from ID3v2 frames
const getTextFrameContent = (uint8Array, start, length, encoding) => {
    // Encoding: 0x00 = ISO-8859-1, 0x01 = UTF-16
    let contentBytes = uint8Array.slice(start, start + length);
    if (encoding === 0x01) {
        // UTF-16: skip BOM if present (0xFF 0xFE or 0xFE 0xFF)
        if (contentBytes[0] === 0xFE && contentBytes[1] === 0xFF) {
            contentBytes = contentBytes.slice(2);
        } else if (contentBytes[0] === 0xFF && contentBytes[1] === 0xFE) {
            contentBytes = contentBytes.slice(2);
        }
        return new TextDecoder('utf-16').decode(contentBytes).replace(/\0/g, '').trim();
    } else {
        // Default to ISO-8859-1 (latin1) for 0x00 and other unknown encodings
        return new TextDecoder('latin1').decode(contentBytes).replace(/\0/g, '').trim();
    }
};

// Function to delete the database if needed
const deleteDatabase = () => {
    return new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
    });
};

const initDB = async () => {
    try {
        // First try to open the database
        const request = indexedDB.open(dbName, dbVersion);
        
        request.onerror = async (event) => {
            console.error('Database error:', event.target.error);
            // If there's an error, try to delete and recreate the database
            await deleteDatabase();
            // Retry database creation
            initDB();
        };

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            window.db = db; // Make db globally accessible
            // Create stores if they don't exist
            if (!db.objectStoreNames.contains('audio')) {
                db.createObjectStore('audio', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' });
            }
            // New store for playlists (supports nesting via parentId)
            if (!db.objectStoreNames.contains('playlists')) {
                db.createObjectStore('playlists', { keyPath: 'id' });
            }
        };

        request.onsuccess = async (event) => {
            db = event.target.result;
            window.db = db; // Make db globally accessible
            console.log('Database initialized successfully');
            
            // Verify stores exist
            if (!db.objectStoreNames.contains('audio') || !db.objectStoreNames.contains('settings') || !db.objectStoreNames.contains('playlists')) {
                console.log('Required stores missing, recreating database...');
                db.close();
                await deleteDatabase();
                // Retry database creation
                initDB();
                return;
            }
            
            // Load last played song or first available song
            await loadInitialSong();
        };
    } catch (error) {
        console.error('Fatal database error:', error);
    }
};

// Simple IndexedDB helpers
function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value);
        req.onsuccess = () => resolve(value);
        req.onerror = () => reject(req.error);
    });
}

function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

// Playlist helpers
function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function createPlaylist({ name, cover = null, parentId = null }) {
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const playlist = {
        id,
        name: name && name.trim() ? name.trim() : await getDefaultPlaylistName(),
        cover: cover || null,
        parentId: parentId || null,
        description: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    await idbPut('playlists', playlist);
    return playlist;
}

async function getDefaultPlaylistName() {
    const all = await idbGetAll('playlists');
    const index = all.length;
    return `Playlist ${index + 1}`;
}

async function renamePlaylist(id, newName) {
    const pl = await idbGet('playlists', id);
    if (!pl) return null;
    pl.name = newName && newName.trim() ? newName.trim() : pl.name;
    pl.updatedAt = Date.now();
    await idbPut('playlists', pl);
    return pl;
}

async function updatePlaylist(id, updates) {
    const pl = await idbGet('playlists', id);
    if (!pl) return null;
    const next = { ...pl, ...updates, updatedAt: Date.now() };
    await idbPut('playlists', next);
    return next;
}

async function deletePlaylist(id, { deleteSongs = false } = {}) {
    // When deleting, optionally move songs out to root or delete them
    const items = await idbGetAll('audio');
    const updated = [];
    for (const item of items) {
        if (item.playlistId === id) {
            if (deleteSongs) {
                await idbDelete('audio', item.id);
            } else {
                delete item.playlistId;
                updated.push(item);
            }
        }
    }
    for (const u of updated) {
        await idbPut('audio', u);
    }

    // Move or delete child playlists (keep nesting; reparent to deleted's parent)
    const playlists = await idbGetAll('playlists');
    const toReparent = playlists.filter(p => p.parentId === id);
    const parent = playlists.find(p => p.id === id);
    const newParentId = parent ? parent.parentId || null : null;
    for (const child of toReparent) {
        child.parentId = newParentId;
        child.updatedAt = Date.now();
        await idbPut('playlists', child);
    }

    await idbDelete('playlists', id);
}

async function moveSongToPlaylist(songId, targetPlaylistId = null) {
    const song = await idbGet('audio', songId);
    if (!song) return null;
    if (targetPlaylistId) {
        const target = await idbGet('playlists', targetPlaylistId);
        if (!target) return null;
        song.playlistId = targetPlaylistId;
        // Inherit cover art: if the playlist has no cover yet, use the first added song's cover
        if (!target.cover && song.cover instanceof Blob) {
            target.cover = song.cover;
            target.updatedAt = Date.now();
            await idbPut('playlists', target);
        }
    } else {
        delete song.playlistId; // move to root
    }
    await idbPut('audio', song);
    return song;
}

async function movePlaylist(playlistId, newParentId = null) {
    if (playlistId === newParentId) return null;
    const pl = await idbGet('playlists', playlistId);
    if (!pl) return null;
    if (newParentId) {
        // Prevent cycles
        let checkId = newParentId;
        while (checkId) {
            if (checkId === playlistId) return null;
            const next = await idbGet('playlists', checkId);
            checkId = next ? next.parentId : null;
        }
    }
    pl.parentId = newParentId || null;
    pl.updatedAt = Date.now();
    await idbPut('playlists', pl);
    return pl;
}

// Initialize the database when the script loads
initDB();

// Function to preload demo songs
async function preloadDemoSongs() {
    try {
        const response = await fetch('assets/demo/OST.mp3');
        const blob = await response.blob();
        const file = new File([blob], 'OST.mp3', { type: 'audio/mpeg' });
        
        // Process the file like a normal upload
        await processAudioFile(file);
    } catch (error) {
        console.error('Error preloading demo songs:', error);
    }
}

// Helper function to get settings
async function getSetting(key) {
    try {
        const setting = await idbGet('settings', key);
        return setting ? setting.value : null;
    } catch (error) {
        console.error('Error getting setting:', error);
        return null;
    }
}

// Helper function to save settings
async function saveSetting(key, value) {
    try {
        await idbPut('settings', { id: key, value });
    } catch (error) {
        console.error('Error saving setting:', error);
    }
}

// Update record appearance
async function updateRecordAppearance(imageUrl = null) {
    const root = document.documentElement;
    
    try {
        if (imageUrl) {
            // If we have a new image URL, use it
            if (imageUrl.startsWith('linear-gradient')) {
                // For gradients, set directly without url()
                root.style.setProperty('--record-bg-image', imageUrl);
                recordInner.style.backgroundImage = imageUrl;
            } else {
                // For actual images, wrap in url()
                root.style.setProperty('--record-bg-image', `url('${imageUrl}')`);
                recordInner.style.backgroundImage = `url('${imageUrl}')`;
            }
            // Only store in lastCoverUrl if it's a gradient (not an object URL)
            if (!imageUrl.startsWith('blob:')) {
                await saveSetting('lastCoverUrl', imageUrl);
            }
        } else {
            // Try to get last stored background
            const lastCoverUrl = await getSetting('lastCoverUrl');
            if (lastCoverUrl) {
                // Only use lastCoverUrl if it's a gradient (not an object URL)
                if (!lastCoverUrl.startsWith('blob:')) {
                    if (lastCoverUrl.startsWith('linear-gradient')) {
                        // For gradients, set directly without url()
                        root.style.setProperty('--record-bg-image', lastCoverUrl);
                        recordInner.style.backgroundImage = lastCoverUrl;
                    } else {
                        // For actual images, wrap in url()
                        root.style.setProperty('--record-bg-image', `url('${lastCoverUrl}')`);
                        recordInner.style.backgroundImage = `url('${lastCoverUrl}')`;
                    }
                } else {
                    // If it was an object URL, clear it as it's no longer valid
                    await saveSetting('lastCoverUrl', null);
                    const gradient = generateRandomGradient();
                    root.style.setProperty('--record-bg-image', gradient);
                    recordInner.style.backgroundImage = gradient;
                }
            } else {
                // Generate a new gradient if no valid lastCoverUrl
                const gradient = generateRandomGradient();
                root.style.setProperty('--record-bg-image', gradient);
                recordInner.style.backgroundImage = gradient;
            }
        }
    } catch (error) {
        console.error('Error updating record appearance:', error);
        // Fallback to random gradient
        const gradient = generateRandomGradient();
        root.style.setProperty('--record-bg-image', gradient);
        recordInner.style.backgroundImage = gradient;
    }
}

// Set default state
async function setDefaultState() {
    songTitleElement.textContent = 'NO SONGS';
    songAuthorElement.textContent = 'Drop a song to begin';
    await updateRecordAppearance();
    // Hide progress bar when no songs
    if (progressBarContainer) {
        progressBarContainer.classList.remove('visible');
    }
}

// Load initial song (last played or first available)
async function loadInitialSong() {
    try {
        // Check if we have any songs
        const songs = await idbGetAll('audio');
        if (songs.length === 0) {
            // No songs - set default state and try to preload demo
            await setDefaultState();
            await preloadDemoSongs();
            return;
        }

        // Try to get last played song
        const lastPlayedId = await getSetting('lastPlayedId');
        let songToLoad = null;

        if (lastPlayedId) {
            songToLoad = await idbGet('audio', lastPlayedId);
        }

        // If no last played or it wasn't found, use first song
        if (!songToLoad) {
            songToLoad = songs[0];
        }

        // Load the song without playing
        if (songToLoad) {
            await loadSong(songToLoad, false);
        } else {
            await setDefaultState();
        }
    } catch (error) {
        console.error('Error loading initial song:', error);
        await setDefaultState();
    }
}

// DOM Elements
const record = document.querySelector('.record');
const recordInner = document.querySelector('.record-inner');
const dropZone = document.querySelector('.drop-zone');
const songTitleElement = document.querySelector('.song-title');
const songAuthorElement = document.querySelector('.song-author');
// Make these globally accessible
window.songTitleElement = songTitleElement;
window.songAuthorElement = songAuthorElement;
const songsButton = document.querySelector('.songs-button');
const songsPanel = document.querySelector('.songs-panel');
const songsList = document.querySelector('.songs-list');
let songCoverObjectUrls = [];
let currentRecordCoverUrl = null; // Track the current record's cover URL separately

// Progress Bar Elements
const progressBarContainer = document.querySelector('.progress-bar-container');
const progressBar = document.querySelector('.progress-bar');
const progressBarTrack = document.querySelector('.progress-bar-track');
const progressBarFill = document.querySelector('.progress-bar-fill');
const progressBarHandle = document.querySelector('.progress-bar-handle');
const progressTimeCurrentElement = document.querySelector('.progress-time-current');
const progressTimeTotalElement = document.querySelector('.progress-time-total');
const playPauseButton = document.querySelector('.play-pause-button');
const nextTrackButton = document.querySelector('.next-track-button');

// Set up canvas for visualization
canvas = document.createElement('canvas');
canvas.className = 'audio-visualizer';
document.body.appendChild(canvas);

// Ensure canvas has fixed size
function resizeCanvas() {
    // Size for bottom bar visualizer
    canvas.width = window.innerWidth;
    canvas.height = 160;
    
    // Update canvas context properties
    canvasCtx = canvas.getContext('2d', { alpha: true });
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
canvasCtx = canvas.getContext('2d');

// Drag state tracking
let dragCounter = 0;
let debounceTimer = null;

// Audio Context
let currentAudio = null;
let isPlaying = false;

// Rotation state
let rotationAngle = 0;
let animationId = null;
let lastTime = 0;
const ROTATION_SPEED = 180; // degrees per second (half rotation per second)

// Dragging state for scrubbing
let isDragging = false;
let dragStartAngle = 0;
let initialPlaybackTime = 0;
let recordRect; // To store the bounding rectangle of the record
let cumulativeRotations = 0; // Track total rotations including fractions
let lastAngle = 0; // Track last angle for rotation counting
let rotationDisplay = document.createElement('div'); // Element to show rotation count
let wasPlaying = false; // Track if audio was playing when scrub started
let mouseDownTime = 0; // Track when mouse was pressed
let mouseStartX = 0; // Track initial mouse position
let mouseStartY = 0;
let isScrubbing = false; // Track if we're actually scrubbing vs clicking

// Progress Bar state
let isProgressBarDragging = false;
let progressBarRect;
let progressBarWasPlaying = false;
let progressAnimationId = null;

// Add frame rate control variables
let lastDrawTime = 0;
const FRAME_INTERVAL = 1000 / 30; // Cap at 30 FPS during scrubbing
const NORMAL_FRAME_INTERVAL = 1000 / 60; // 60 FPS during normal playback

// Style the rotation display
rotationDisplay.style.position = 'absolute';
rotationDisplay.style.top = '10px';
rotationDisplay.style.left = '10px';
rotationDisplay.style.background = 'rgba(0, 0, 0, 0.7)';
rotationDisplay.style.color = 'white';
rotationDisplay.style.padding = '5px 10px';
rotationDisplay.style.borderRadius = '5px';
rotationDisplay.style.display = 'none';
document.body.appendChild(rotationDisplay);

// Add click handler for playback
record.addEventListener('click', (e) => {
    // Only handle click if we weren't scrubbing
    if (!isScrubbing) {
        handlePlayback();
    }
});

// Add space bar control for playback
window.addEventListener('keydown', (e) => {
    // Check if it's the space bar and we're not in an input field
    if (e.code === 'Space' && !(e.target.matches('input, textarea'))) {
        e.preventDefault(); // Prevent page scroll
        handlePlayback();
    }
});

// Add keyboard navigation for songs panel
window.addEventListener('keydown', (e) => {
    // Tab to toggle songs panel (only if no edit dialog is open)
    if (e.code === 'Tab') {
        // If edit dialog is open, allow default Tab behavior for form navigation
        if (contextMenu && contextMenu.isEditDialogOpen()) {
            return; // Let default Tab behavior handle form navigation
        }
        
        e.preventDefault(); // Prevent default tab behavior
        if (songsPanel) {
            const isOpen = songsPanel.classList.contains('open');
            if (!isOpen) {
                renderSongs();
                songsPanel.classList.add('open');
                songsPanel.setAttribute('aria-hidden', 'false');
                // Focus the first song when opening
                const firstSong = songsList.querySelector('.song-item');
                if (firstSong) {
                    firstSong.focus();
                }
            } else {
                songsPanel.classList.remove('open');
                songsPanel.setAttribute('aria-hidden', 'true');
                clearSongObjectUrls();
            }
        }
    }

    // Arrow key navigation when songs panel is open
    if (songsPanel && songsPanel.classList.contains('open')) {
        const songs = Array.from(songsList.querySelectorAll('.song-item'));
        const currentSong = document.activeElement;
        let currentIndex = songs.indexOf(currentSong);

        if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
            e.preventDefault();
            if (songs.length === 0) return;
            if (currentIndex < songs.length - 1 && currentIndex !== -1) {
                songs[currentIndex + 1].focus();
            } else if (currentIndex === songs.length - 1) {
                // If at bottom, go to top
                songs[0]?.focus();
            } else if (currentIndex === -1) {
                // If no song is focused, focus the first one
                songs[0]?.focus();
            }
        } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
            e.preventDefault();
            if (songs.length === 0) return;
            if (currentIndex > 0) {
                songs[currentIndex - 1].focus();
            } else if (currentIndex === 0) {
                // If at top, go to bottom
                songs[songs.length - 1]?.focus();
            } else if (currentIndex === -1) {
                // If no song is focused, focus the last one
                songs[songs.length - 1]?.focus();
            }
        } else if (e.code === 'Enter' && currentIndex !== -1) {
            // Load and play the selected song on Enter
            const songId = songs[currentIndex].dataset.id;
            idbGet('audio', songId).then(item => {
                if (item) {
                    loadSong(item);
                    songsPanel.classList.remove('open');
                    songsPanel.setAttribute('aria-hidden', 'true');
                }
            });
        }
    }
});

// Add mouse handlers for scrubbing
record.addEventListener('mousedown', handleScrubStart);
record.addEventListener('mousemove', handleScrubbing);
record.addEventListener('mouseup', handleScrubEnd);
record.addEventListener('mouseleave', handleScrubEnd); // End scrub if mouse leaves record

// Prevent default drag behaviors and handle drop zone
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, preventDefaults, { capture: true });
});

// Handle drag enter/leave with counter
document.body.addEventListener('dragenter', (e) => {
    preventDefaults(e);
    
    // Only handle audio files
    const items = e.dataTransfer?.items;
    if (items && items[0]?.type.startsWith('audio/')) {
        dragCounter++;
        if (dragCounter === 1) {
            clearTimeout(debounceTimer);
            highlight();
        }
    }
}, { capture: true });

document.body.addEventListener('dragleave', (e) => {
    preventDefaults(e);
    
    // Ignore if not at boundary
    if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) {
        dragCounter--;
        if (dragCounter === 0) {
            debounceTimer = setTimeout(unhighlight, 50);
        }
    }
}, { capture: true });

document.body.addEventListener('drop', (e) => {
    preventDefaults(e);
    dragCounter = 0;
    unhighlight();
    handleDrop(e);
}, { capture: true });

// Handle window focus/blur to manage drop zone visibility
window.addEventListener('blur', () => {
    // Reset drag state when window loses focus
    dragCounter = 0;
    clearTimeout(debounceTimer);
    unhighlight();
});

window.addEventListener('focus', () => {
    // Ensure clean state when window regains focus
    dragCounter = 0;
    clearTimeout(debounceTimer);
    unhighlight();
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    dropZone.classList.add('active');
}

function unhighlight() {
    dropZone.classList.remove('active');
}

async function handleDrop(e) {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        await processAudioFile(file);
    }
}

// Compute a stable ID for a file (SHA-1 of content, fallback to name-size-mtime)
async function computeFileId(file) {
    try {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `sha1_${hashHex}`;
    } catch (err) {
        return `${file.name}_${file.size}_${file.lastModified}`;
    }
}

// Process the dropped audio file
async function processAudioFile(file, initialMetadata = null) {
    try {
        // Stop any currently playing audio
        stopAudio();
        
        // Clean up any existing record cover URL
        if (currentRecordCoverUrl && currentRecordCoverUrl.startsWith('blob:')) {
            URL.revokeObjectURL(currentRecordCoverUrl);
            currentRecordCoverUrl = null;
        }

        // Compute ID and extract metadata
        const [id, extracted] = await Promise.all([
            computeFileId(file),
            extractMetadata(file)
        ]);

        // Merge metadata: prefer initial metadata from caller, then extracted, then filename fallback
        const filenameMeta = deriveMetadataFromFilename(file.name);
        const mergedMetadata = {
            title: (initialMetadata?.title || extracted.title || filenameMeta.title || 'UNKNOWN').toString(),
            artist: (initialMetadata?.artist || initialMetadata?.author || extracted.artist || filenameMeta.artist || 'UNNAMED').toString(),
            coverBlob: extracted.coverBlob || null,
            coverUrl: extracted.coverUrl || null
        };

        // If no embedded cover, try to fetch thumbnail provided by caller
        if (!mergedMetadata.coverBlob && initialMetadata?.thumbnail) {
            try {
                const apiBaseUrl = window.inputHandler?.getApiBaseUrl() || 'http://localhost:3000';
                const resp = await fetch(`${apiBaseUrl}/api/proxy-thumbnail?url=${encodeURIComponent(initialMetadata.thumbnail)}`);
                if (resp.ok) {
                    const blob = await resp.blob();
                    mergedMetadata.coverBlob = blob;
                    mergedMetadata.coverUrl = URL.createObjectURL(blob);
                }
            } catch (e) {
                console.warn('Failed to fetch thumbnail:', e);
                // ignore thumbnail fetch errors; continue without cover
            }
        }

        // Generate a permanent gradient if no cover art
        const gradient = !mergedMetadata.coverBlob ? generateRandomGradient() : null;

        // Store in IndexedDB (upsert without clearing)
        const audioRecord = {
            id,
            file,
            title: mergedMetadata.title,
            artist: mergedMetadata.artist,
            cover: mergedMetadata.coverBlob || null,
            gradient: gradient, // Store permanent gradient if no cover
            createdAt: Date.now()
        };
        await idbPut('audio', audioRecord);

        // Update UI appearance and text
        songTitleElement.textContent = mergedMetadata.title || 'UNKNOWN';
        songAuthorElement.textContent = mergedMetadata.artist || 'UNNAMED';
        if (mergedMetadata.coverUrl) {
            setCurrentRecordCover(mergedMetadata.coverUrl);
            updateRecordAppearance(mergedMetadata.coverUrl);
        } else if (gradient) {
            updateRecordAppearance(gradient);
        } else {
            updateRecordAppearance();
        }

        // Set up audio playback
        await setupAudioPlayback(file);

        // Start rotation and play audio
        handlePlayback();

        // Refresh songs list
        renderSongs();

    } catch (error) {
        console.error('Error processing audio file:', error);
    }
}

// Extract metadata from audio file (returns { title, artist, coverBlob, coverUrl })
async function extractMetadata(file) {
    const metadata = { title: 'UNKNOWN', artist: 'UNNAMED', coverBlob: null, coverUrl: null };
    try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Look for ID3v2 header
        if (uint8Array[0] === 0x49 && uint8Array[1] === 0x44 && uint8Array[2] === 0x33) {
            // Parse ID3v2 tags
            let offset = 10; // Skip main header
            const size = ((uint8Array[6] & 0x7f) << 21) |
                        ((uint8Array[7] & 0x7f) << 14) |
                        ((uint8Array[8] & 0x7f) << 7) |
                        (uint8Array[9] & 0x7f);

            while (offset < size + 10) {
                const frameID = String.fromCharCode(...uint8Array.slice(offset, offset + 4));
                const frameSize = (uint8Array[offset + 4] << 24) |
                                (uint8Array[offset + 5] << 16) |
                                (uint8Array[offset + 6] << 8) |
                                uint8Array[offset + 7];
                
                // Check for common text frames (TPE1 for artist, TIT2 for title)
                if (frameID === 'TPE1' || frameID === 'TIT2') {
                    const encoding = uint8Array[offset + 10];
                    const textContent = getTextFrameContent(uint8Array, offset + 11, frameSize - 1, encoding);

                    if (frameID === 'TIT2') {
                        metadata.title = textContent || 'UNKNOWN';
                    } else if (frameID === 'TPE1') {
                        metadata.artist = textContent || 'UNNAMED';
                    }
                }
                
                // Check for APIC frame (attached picture)
                if (frameID === 'APIC') {
                    const pictureData = uint8Array.slice(offset + 10, offset + 10 + frameSize);
                    let imgStart = 0;
                    
                    // Find image data start
                    for (let i = 0; i < pictureData.length - 2; i++) {
                        if (pictureData[i] === 0xFF && pictureData[i + 1] === 0xD8) {
                            imgStart = i;
                            break;
                        }
                    }
                    
                    const blob = new Blob([pictureData.slice(imgStart)], { type: 'image/jpeg' });
                    metadata.coverBlob = blob;
                    metadata.coverUrl = URL.createObjectURL(blob);
                    // No need to continue parsing once we found cover art; break after setting
                }
                
                offset += 10 + frameSize;
            }
        }
        
        // Update UI fallbacks handled by caller
        return metadata;
        
    } catch (error) {
        console.error('Error extracting metadata:', error);
        return metadata;
    }
}

// Fallback: derive title/artist from filename patterns like "Artist - Title.ext"
function deriveMetadataFromFilename(filename) {
    try {
        const nameOnly = filename.replace(/\.[^/.]+$/, '');
        // Common pattern: Artist - Title
        const dashMatch = nameOnly.match(/^(.*?)\s*-\s*(.*)$/);
        if (dashMatch) {
            const artist = dashMatch[1].trim();
            const title = dashMatch[2].trim();
            if (artist && title) {
                return { title, artist };
            }
        }
        // Alternative pattern: Title (Artist) or Title [Artist]
        const parenMatch = nameOnly.match(/^(.*?)\s*(?:\(|\[)([^)\]]+)(?:\)|\])\s*$/);
        if (parenMatch) {
            const title = parenMatch[1].trim();
            const artist = parenMatch[2].trim();
            if (artist && title) {
                return { title, artist };
            }
        }
        // Default: use whole name as title
        return { title: nameOnly.trim(), artist: '' };
    } catch (e) {
        return { title: filename, artist: '' };
    }
}

// Helper function to get the next song in the playlist
async function getNextSong(currentId) {
    try {
        const songs = await idbGetAll('audio');
        if (!songs.length) return null;
        
        // Sort by creation date like in renderSongs
        songs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        // Find current song index
        const currentIndex = songs.findIndex(song => song.id === currentId);
        
        // If current song not found or it's the last song, loop to first song
        if (currentIndex === -1 || currentIndex === songs.length - 1) {
            return songs[0];
        }
        
        // Return next song
        return songs[currentIndex + 1];
    } catch (error) {
        console.error('Error getting next song:', error);
        return null;
    }
}

// Set up audio playback
async function setupAudioPlayback(file) {
    try {
        // Create HTML5 Audio element for easier pause/resume control
        currentAudio = new Audio();
        const audioUrl = URL.createObjectURL(file);
        currentAudio.src = audioUrl;
        
        // Initialize Web Audio API context and analyzer
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Main analyzer for simple bar visualization
            analyzer = audioContext.createAnalyser();
            analyzer.fftSize = FFT_SIZE;
            dataArray = new Uint8Array(analyzer.frequencyBinCount);
        }

        // Connect audio element to analyzer
        if (audioSource) {
            audioSource.disconnect();
        }
        audioSource = audioContext.createMediaElementSource(currentAudio);
        
        // Simple audio chain: source -> analyzer -> destination
        audioSource.connect(analyzer);
        analyzer.connect(audioContext.destination);
        
        // Add event listeners
        currentAudio.addEventListener('ended', async () => {
            isPlaying = false;
            stopRotation();
            stopProgressBarAnimation();
            updatePlayPauseButton();
            
            // Get and play next song
            const currentId = await getSetting('lastPlayedId');
            const nextSong = await getNextSong(currentId);
            
            if (nextSong) {
                await loadSong(nextSong, true); // Load and play the next song
            }
        });
        
        currentAudio.addEventListener('loadeddata', () => {
            console.log('Audio loaded and ready to play');
            // Update progress bar when audio is loaded
            updateProgressBar();
        });
        
        // Update progress bar on metadata load (for duration)
        currentAudio.addEventListener('loadedmetadata', () => {
            updateProgressBar();
        });
        
    } catch (error) {
        console.error('Error setting up audio playback:', error);
    }
}

// Handle record click for playback
async function handlePlayback() {
    if (!currentAudio) return;

    try {
        // Resume audio context if suspended (needed for Chrome)
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (isPlaying) {
            // Pause the audio
            currentAudio.pause();
            isPlaying = false;
            stopRotation();
            stopProgressBarAnimation();
            updatePlayPauseButton();
        } else {
            // Play the audio
            await currentAudio.play();
            isPlaying = true;
            startRotation();
            startProgressBarAnimation();
            updatePlayPauseButton();
            // Force initial visualization frame
            drawVisualization(true);
        }
    } catch (error) {
        console.error('Error during playback:', error);
    }
}

// Start rotation animation
function startRotation() {
    if (animationId) return; // Already rotating
    
    lastTime = performance.now();
    animateRotation();
}

// Stop rotation animation
function stopRotation() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

// Stop audio playback
function stopAudio() {
    if (currentAudio && isPlaying) {
        currentAudio.pause();
        isPlaying = false;
        stopRotation();
        stopProgressBarAnimation();
        updatePlayPauseButton();
    }
}

// Update play/pause button icon
function updatePlayPauseButton() {
    if (!playPauseButton) return;
    
    const icon = playPauseButton.querySelector('i');
    if (!icon) return;
    
    if (isPlaying) {
        icon.className = 'fas fa-pause';
        playPauseButton.classList.add('playing');
    } else {
        icon.className = 'fas fa-play';
        playPauseButton.classList.remove('playing');
    }
}



// Simple center-split mirrored bar visualizer at the bottom
function drawVisualization(forceDraw = false) {
    if (!analyzer || (!isPlaying && !isScrubbing && !isProgressBarDragging)) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - lastDrawTime;
    
    // Apply frame rate limiting
    const targetInterval = (isScrubbing || isProgressBarDragging) ? FRAME_INTERVAL : NORMAL_FRAME_INTERVAL;
    if (!forceDraw && deltaTime < targetInterval) {
        requestAnimationFrame(() => drawVisualization());
        return;
    }
    
    lastDrawTime = currentTime;

    // Get frequency data
    analyzer.getByteFrequencyData(dataArray);

    // Clear the canvas
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate bar count and spacing for 2-way center split layout with fixed bar width
    const fixedBarWidth = 4; // Fixed 4-pixel width for each bar
    const barSpacing = 1;
    const centerX = canvas.width / 2; // Center point of the screen
    const barsPerSide = Math.floor(centerX / (fixedBarWidth + barSpacing)); // How many bars fit on each side
    
    // Optimize by pre-calculating common values
    const activeFreqRange = Math.floor(dataArray.length * 0.6); // Use only first 60% of frequency data
    const freqStep = activeFreqRange / barsPerSide;
    const maxHeight = canvas.height * 0.9;

    // Draw 2-way mirrored bars from center outward
    for (let i = 0; i < barsPerSide; i++) {
        // Sample frequency data from the more active lower frequency range
        const dataIndex = Math.floor(i * freqStep);
        const value = dataArray[dataIndex];
        const normalizedValue = value / 255;
        
        // Calculate bar height (from bottom up)
        const barHeight = normalizedValue * maxHeight;
        
        // Create grayscale color based on amplitude
        const lightness = 30 + (normalizedValue * 50); // Range from dark gray to light gray
        const alpha = 0.7 + (normalizedValue * 0.3);
        
        // Cache the color string for reuse on both sides
        const barColor = `hsla(0, 0%, ${lightness}%, ${alpha})`;
        canvasCtx.fillStyle = barColor;
        
        // Calculate positions
        const y = canvas.height - barHeight;
        
        // Left side bar (center going left)
        const leftX = centerX - (i + 1) * (fixedBarWidth + barSpacing);
        canvasCtx.fillRect(leftX, y, fixedBarWidth, barHeight);
        
        // Right side bar (center going right)
        const rightX = centerX + i * (fixedBarWidth + barSpacing);
        canvasCtx.fillRect(rightX, y, fixedBarWidth, barHeight);
    }

    requestAnimationFrame(() => drawVisualization());
}

// Animate rotation using requestAnimationFrame
function animateRotation() {
    const currentTime = performance.now();
    const deltaTime = (currentTime - lastTime) / 2000; // Convert to seconds
    lastTime = currentTime;
    
    // Update rotation angle
    rotationAngle += ROTATION_SPEED * deltaTime;
    rotationAngle = rotationAngle % 360; // Keep angle between 0-360
    
    // Apply rotation to elements
    record.style.setProperty('--record-rotation', `${rotationAngle}deg`);
    recordInner.style.transform = `rotate(${rotationAngle}deg)`;
    
    // Continue animation if playing
    if (isPlaying) {
        animationId = requestAnimationFrame(animateRotation);
    }
}

// Generate random gradient
function generateRandomGradient() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD',
        '#D4A5A5', '#9B786F', '#A8E6CF', '#DCEDC1', '#FFD3B6'
    ];
    
    const getRandomColor = () => colors[Math.floor(Math.random() * colors.length)];
    const getRandomAngle = () => Math.floor(Math.random() * 360);
    
    const color1 = getRandomColor();
    const color2 = getRandomColor();
    const angle = getRandomAngle();
    
    return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
}

// Progress Bar utility functions
function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function updateProgressBar() {
    if (!currentAudio || !currentAudio.duration) {
        progressBarContainer.classList.remove('visible');
        stopProgressBarAnimation();
        return;
    }
    
    // Show progress bar when audio is loaded
    progressBarContainer.classList.add('visible');
    
    // Update time displays
    progressTimeCurrentElement.textContent = formatTime(currentAudio.currentTime);
    progressTimeTotalElement.textContent = formatTime(currentAudio.duration);
    
    // Update progress fill and handle position (only if not dragging)
    if (!isProgressBarDragging) {
        const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
        updateProgressVisuals(progress);
    }
}

function updateProgressVisuals(progress) {
    // Update both fill and handle simultaneously to prevent desync
    const clampedProgress = Math.max(0, Math.min(100, progress));
    progressBarFill.style.width = `${clampedProgress}%`;
    progressBarHandle.style.left = `${clampedProgress}%`;
}

function startProgressBarAnimation() {
    if (progressAnimationId) return; // Already animating
    
    function animateProgress() {
        if (currentAudio && currentAudio.duration && isPlaying && !isProgressBarDragging) {
            updateProgressBar();
        }
        
        if (isPlaying) {
            progressAnimationId = requestAnimationFrame(animateProgress);
        } else {
            progressAnimationId = null;
        }
    }
    
    progressAnimationId = requestAnimationFrame(animateProgress);
}

function stopProgressBarAnimation() {
    if (progressAnimationId) {
        cancelAnimationFrame(progressAnimationId);
        progressAnimationId = null;
    }
}

function setProgressBarTime(percentage) {
    if (!currentAudio || !currentAudio.duration) return;
    
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    const newTime = (clampedPercentage / 100) * currentAudio.duration;
    currentAudio.currentTime = Math.max(0, Math.min(newTime, currentAudio.duration));
    
    // Update visuals immediately and synchronously
    updateProgressVisuals(clampedPercentage);
    progressTimeCurrentElement.textContent = formatTime(currentAudio.currentTime);
    
    // Sync record rotation with progress bar scrubbing
    // Calculate rotation based on time: TIME_PER_ROTATION = 5 seconds
    const TIME_PER_ROTATION = 5;
    const rotationsFromTime = currentAudio.currentTime / TIME_PER_ROTATION;
    const newRotationAngle = (rotationsFromTime * 360) % 360;
    
    // Update record rotation
    rotationAngle = newRotationAngle;
    record.style.setProperty('--record-rotation', `${rotationAngle}deg`);
    recordInner.style.transform = `rotate(${rotationAngle}deg)`;
}

// Handle scrubbing functionality
function handleScrubStart(e) {
    e.preventDefault();
    if (!currentAudio || !currentAudio.duration) return;

    isDragging = true;
    wasPlaying = isPlaying;
    mouseDownTime = Date.now();
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    isScrubbing = false; // Reset scrubbing state
    
    initialPlaybackTime = currentAudio.currentTime;
    recordRect = record.getBoundingClientRect();
    dragStartAngle = Math.atan2(e.clientY - (recordRect.top + recordRect.height / 2), 
                               e.clientX - (recordRect.left + recordRect.width / 2)) * (180 / Math.PI);
    lastAngle = dragStartAngle;
    cumulativeRotations = 0;
}

function handleScrubbing(e) {
    e.preventDefault();
    if (!isDragging || !currentAudio || !currentAudio.duration) return;

    // Check if we should start scrubbing
    if (!isScrubbing) {
        const dx = e.clientX - mouseStartX;
        const dy = e.clientY - mouseStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const timeSinceMouseDown = Date.now() - mouseDownTime;
        
        // Start scrubbing if mouse moved more than 5px or held for more than 200ms
        if (distance > 5 || timeSinceMouseDown > 200) {
            isScrubbing = true;
            // Only now do we show the rotation display and pause normal playback
            rotationDisplay.style.display = 'block';
            rotationDisplay.textContent = '0.00×';
            if (isPlaying) {
                isPlaying = false;
                stopRotation();
                stopProgressBarAnimation();
            }
        } else {
            return; // Not scrubbing yet
        }
    }

    const centerX = recordRect.left + recordRect.width / 2;
    const centerY = recordRect.top + recordRect.height / 2;
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    let angleDelta = currentAngle - lastAngle;

    // Handle angle wrapping
    if (angleDelta > 180) angleDelta -= 360;
    if (angleDelta < -180) angleDelta += 360;

    // Update cumulative rotations
    cumulativeRotations += angleDelta / 360;

    // Update rotation display with 2 decimal places
    rotationDisplay.textContent = `${cumulativeRotations.toFixed(2)}×`;

    // Calculate new playback time based on rotations
    const TIME_PER_ROTATION = 5; // seconds
    const timeDelta = cumulativeRotations * TIME_PER_ROTATION;
    let newPlaybackTime = initialPlaybackTime + timeDelta;

    // Clamp playback time to valid range
    newPlaybackTime = Math.max(0, Math.min(newPlaybackTime, currentAudio.duration));

    // Update audio time
    currentAudio.currentTime = newPlaybackTime;

    // Update visual rotation of the record
    rotationAngle = (rotationAngle + angleDelta) % 360;
    record.style.setProperty('--record-rotation', `${rotationAngle}deg`);
    recordInner.style.transform = `rotate(${rotationAngle}deg)`;

    // Update progress bar to sync with record scrubbing
    if (currentAudio.duration) {
        const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
        updateProgressVisuals(progress);
        progressTimeCurrentElement.textContent = formatTime(currentAudio.currentTime);
    }

    // Update last angle for next calculation
    lastAngle = currentAngle;

    // Force visualizer update during scrubbing, but respect frame rate
    drawVisualization(true);
}

function handleScrubEnd(e) {
    e.preventDefault();
    if (!isDragging) return;

    isDragging = false;

    if (isScrubbing) {
        // Was scrubbing - hide display and restore previous playback state
        rotationDisplay.style.display = 'none';
        if (wasPlaying) {
            currentAudio.play().then(() => {
                isPlaying = true;
                startRotation();
                startProgressBarAnimation();
                updatePlayPauseButton();
                // Restart visualization
                drawVisualization();
            }).catch(err => console.error('Error resuming playback:', err));
        }
    }

    isScrubbing = false;
}

// Progress Bar scrubbing handlers
function handleProgressBarMouseDown(e) {
    e.preventDefault();
    if (!currentAudio || !currentAudio.duration) return;
    
    isProgressBarDragging = true;
    progressBarWasPlaying = isPlaying;
    progressBarRect = progressBarTrack.getBoundingClientRect();
    
    // Add dragging class for visual feedback
    progressBarHandle.classList.add('dragging');
    
    // Pause audio during scrubbing but keep visualizer running
    if (isPlaying) {
        currentAudio.pause();
        isPlaying = false;
        stopRotation();
        stopProgressBarAnimation();
        // Don't update play/pause button during scrubbing to avoid visual flicker
    }
    
    // Calculate and set initial position
    const percentage = Math.max(0, Math.min(100, ((e.clientX - progressBarRect.left) / progressBarRect.width) * 100));
    setProgressBarTime(percentage);
    
    // Start visualizer for scrubbing feedback
    drawVisualization(true);
    
    // Add global event listeners
    document.addEventListener('mousemove', handleProgressBarMouseMove);
    document.addEventListener('mouseup', handleProgressBarMouseUp);
}

function handleProgressBarMouseMove(e) {
    e.preventDefault();
    if (!isProgressBarDragging || !currentAudio || !currentAudio.duration) return;
    
    const percentage = Math.max(0, Math.min(100, ((e.clientX - progressBarRect.left) / progressBarRect.width) * 100));
    
    // Update visuals immediately for responsive feedback
    updateProgressVisuals(percentage);
    
    // Update audio time and other sync operations
    const newTime = (percentage / 100) * currentAudio.duration;
    currentAudio.currentTime = Math.max(0, Math.min(newTime, currentAudio.duration));
    progressTimeCurrentElement.textContent = formatTime(currentAudio.currentTime);
    
    // Sync record rotation
    const TIME_PER_ROTATION = 5;
    const rotationsFromTime = currentAudio.currentTime / TIME_PER_ROTATION;
    const newRotationAngle = (rotationsFromTime * 360) % 360;
    rotationAngle = newRotationAngle;
    record.style.setProperty('--record-rotation', `${rotationAngle}deg`);
    recordInner.style.transform = `rotate(${rotationAngle}deg)`;
    
    // Keep visualizer running during scrubbing
    drawVisualization(true);
}

function handleProgressBarMouseUp(e) {
    e.preventDefault();
    if (!isProgressBarDragging) return;
    
    isProgressBarDragging = false;
    progressBarHandle.classList.remove('dragging');
    
    // Resume playback if it was playing before
    if (progressBarWasPlaying && currentAudio) {
        currentAudio.play().then(() => {
            isPlaying = true;
            startRotation();
            startProgressBarAnimation();
            updatePlayPauseButton();
            // Restart visualizer after scrubbing
            drawVisualization(true);
        }).catch(err => console.error('Error resuming playback:', err));
    }
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleProgressBarMouseMove);
    document.removeEventListener('mouseup', handleProgressBarMouseUp);
}

// Add progress bar event listeners
if (progressBar) {
    progressBar.addEventListener('mousedown', handleProgressBarMouseDown);
}

// Add play/pause button functionality
if (playPauseButton) {
    playPauseButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handlePlayback();
    });
}

// Add next track button functionality
if (nextTrackButton) {
    nextTrackButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!currentAudio) return;
        
        // Get current song ID and find next song
        const currentId = await getSetting('lastPlayedId');
        const nextSong = await getNextSong(currentId);
        
        if (nextSong) {
            await loadSong(nextSong, true); // Load and play the next song
        } else {
            // If no next song, could show a message or restart from first song
            console.log('No next song available');
        }
    });
}

// Progress bar hover behavior for desktop
let progressBarHideTimer = null;
let isMobile = false;

// Detect if device is mobile or doesn't support hover
function checkIfMobile() {
    return window.innerWidth <= 768 || !window.matchMedia('(hover: hover)').matches;
}

// Update mobile status on resize
window.addEventListener('resize', () => {
    isMobile = checkIfMobile();
    updateProgressBarVisibility();
});

// Initialize mobile detection
isMobile = checkIfMobile();

// Mouse move handler for progress bar visibility
function handleMouseMove(e) {
    if (isMobile) return; // Don't handle on mobile
    
    const windowHeight = window.innerHeight;
    const bottomThird = windowHeight * (2/3); // Show when mouse is in bottom 1/3
    
    if (e.clientY > bottomThird) {
        showProgressBar();
    } else {
        scheduleHideProgressBar();
    }
}

// Show progress bar
function showProgressBar() {
    if (isMobile) return; // Mobile always shows via CSS
    
    if (progressBarHideTimer) {
        clearTimeout(progressBarHideTimer);
        progressBarHideTimer = null;
    }
    
    if (progressBarContainer) {
        progressBarContainer.classList.add('visible');
    }
}

// Schedule hiding progress bar
function scheduleHideProgressBar() {
    if (isMobile) return; // Mobile always shows via CSS
    
    if (progressBarHideTimer) {
        clearTimeout(progressBarHideTimer);
    }
    
    progressBarHideTimer = setTimeout(() => {
        if (progressBarContainer) {
            progressBarContainer.classList.remove('visible');
        }
        progressBarHideTimer = null;
    }, 1000); // Hide after 1 second of no mouse movement in area
}

// Update progress bar visibility based on mobile status
function updateProgressBarVisibility() {
    if (!progressBarContainer) return;
    
    if (isMobile) {
        // Mobile: always show, remove event listeners
        progressBarContainer.classList.add('visible');
        document.removeEventListener('mousemove', handleMouseMove);
        if (progressBarHideTimer) {
            clearTimeout(progressBarHideTimer);
            progressBarHideTimer = null;
        }
    } else {
        // Desktop: add mouse move listener, initially hidden
        document.addEventListener('mousemove', handleMouseMove);
        progressBarContainer.classList.remove('visible');
    }
}

// Initialize progress bar visibility
updateProgressBarVisibility();

// Songs UI logic
function clearSongObjectUrls() {
    songCoverObjectUrls.forEach(url => URL.revokeObjectURL(url));
    songCoverObjectUrls = [];
}

function setCurrentRecordCover(coverUrl) {
    // Clean up previous record cover URL if it exists
    if (currentRecordCoverUrl && currentRecordCoverUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentRecordCoverUrl);
    }
    currentRecordCoverUrl = coverUrl;
}

async function renderSongs() {
    if (!db || !songsList) return;
    clearSongObjectUrls();
    songsList.innerHTML = '';

    const [allSongs, allPlaylists] = await Promise.all([
        idbGetAll('audio'),
        idbGetAll('playlists')
    ]);

    // Ensure gradients for songs
    for (const s of allSongs) {
        if (!s.cover && !s.gradient) {
            s.gradient = generateRandomGradient();
            await idbPut('audio', s);
        }
    }

    // Build tree: playlists by id
    const playlistById = new Map(allPlaylists.map(p => [p.id, p]));
    const childrenMap = new Map();
    for (const p of allPlaylists) {
        const list = childrenMap.get(p.parentId || 'root') || [];
        list.push(p);
        childrenMap.set(p.parentId || 'root', list);
    }

    // Songs by playlistId
    const songsByPlaylist = new Map();
    for (const s of allSongs) {
        const key = s.playlistId || 'root';
        const list = songsByPlaylist.get(key) || [];
        list.push(s);
        songsByPlaylist.set(key, list);
    }

    // Sort utility
    const sortByCreatedDesc = (arr) => arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    function createSongItem(item) {
        const wrapper = document.createElement('div');
        wrapper.className = 'song-item';
        wrapper.dataset.id = item.id;
        wrapper.dataset.title = item.title || 'UNKNOWN';
        wrapper.dataset.playlistId = item.playlistId || 'root';
        wrapper.dataset.type = 'song';
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'button');
        wrapper.setAttribute('aria-label', `Play ${item.title || 'Unknown'} by ${item.artist || 'Unnamed'}`);

        const cover = document.createElement('div');
        cover.className = 'song-cover';
        
        const coverInner = document.createElement('div');
        coverInner.className = 'song-cover-inner';
        
        const coverDot = document.createElement('div');
        coverDot.className = 'song-cover-dot';
        
        if (item.cover instanceof Blob) {
            const url = URL.createObjectURL(item.cover);
            songCoverObjectUrls.push(url);
            coverInner.style.backgroundImage = `url('${url}')`;
        } else {
            coverInner.style.backgroundImage = item.gradient;
        }
        
        coverInner.appendChild(coverDot);
        cover.appendChild(coverInner);

        const meta = document.createElement('div');
        meta.className = 'song-meta';
        const title = document.createElement('div');
        title.className = 'song-title';
        title.textContent = item.title || 'UNKNOWN';
        const artist = document.createElement('div');
        artist.className = 'song-artist';
        artist.textContent = item.artist || 'UNNAMED';
        meta.appendChild(title);
        meta.appendChild(artist);

        wrapper.appendChild(cover);
        wrapper.appendChild(meta);

        wrapper.addEventListener('click', async () => {
            await loadSong(item);
            if (songsPanel) {
                songsPanel.classList.remove('open');
                songsPanel.setAttribute('aria-hidden', 'true');
            }
        });

        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            contextMenu.show(e.clientX, e.clientY, item);
        });

        return wrapper;
    }

    function createPlaylistItem(playlist, depth = 0) {
        const wrapper = document.createElement('div');
        wrapper.className = 'playlist-item';
        wrapper.dataset.id = playlist.id;
        wrapper.dataset.name = playlist.name || 'Playlist';
        wrapper.dataset.type = 'playlist';
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'group');
        wrapper.style.setProperty('--nest-depth', String(depth));

        // Visual header
        const header = document.createElement('div');
        header.className = 'playlist-header';

        const cover = document.createElement('div');
        cover.className = 'playlist-cover';
        if (playlist.cover instanceof Blob) {
            const url = URL.createObjectURL(playlist.cover);
            songCoverObjectUrls.push(url);
            cover.style.setProperty('--playlist-cover-image', `url('${url}')`);
        } else {
            // Use a subtle gradient fallback
            const g1 = '#222';
            const g2 = '#111';
            cover.style.setProperty('--playlist-cover-image', `linear-gradient(135deg, ${g1}, ${g2})`);
        }

        const meta = document.createElement('div');
        meta.className = 'playlist-meta';
        const name = document.createElement('div');
        name.className = 'playlist-name';
        name.textContent = playlist.name || 'Playlist';
        meta.appendChild(name);
        
        // Add description if it exists and is not empty
        if (playlist.description && playlist.description.trim()) {
            const description = document.createElement('div');
            description.className = 'playlist-description';
            description.textContent = playlist.description.trim();
            meta.appendChild(description);
        }

        header.appendChild(cover);
        header.appendChild(meta);
        wrapper.appendChild(header);

        // Expand/collapse
        const content = document.createElement('div');
        content.className = 'playlist-content';
        wrapper.appendChild(content);

        // Interactions for playlist header
        header.addEventListener('click', () => {
            wrapper.classList.toggle('expanded');
        });

        header.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            await ensurePlaylistContextMenu();
            window.playlistContextMenu.show(e.clientX, e.clientY, playlist);
        });

        // Render children: child playlists then songs
        const childPlaylists = sortByCreatedDesc([...(childrenMap.get(playlist.id) || [])]);
        const songs = sortByCreatedDesc([...(songsByPlaylist.get(playlist.id) || [])]);

        for (const child of childPlaylists) {
            const itemEl = createPlaylistItem(child, depth + 1);
            content.appendChild(itemEl);
        }
        for (const s of songs) {
            const itemEl = createSongItem(s);
            itemEl.classList.add('in-playlist');
            content.appendChild(itemEl);
        }

        return wrapper;
    }

    // Root: playlists first, then root songs
    const rootPlaylists = sortByCreatedDesc([...(childrenMap.get('root') || [])]);
    const rootSongs = sortByCreatedDesc([...(songsByPlaylist.get('root') || [])]);

    for (const pl of rootPlaylists) {
        songsList.appendChild(createPlaylistItem(pl, 0));
    }
    for (const s of rootSongs) {
        songsList.appendChild(createSongItem(s));
    }

    // Animate items
    const items = Array.from(songsList.querySelectorAll('.song-item, .playlist-item'));
    const DELAY_INCREMENT = 40;
    const BASE_DELAY = 10;
    items.reverse().forEach((el, idx) => {
        setTimeout(() => el.classList.add('animate'), BASE_DELAY + idx * DELAY_INCREMENT);
    });

    // Wire up drag and drop interactions
    wireDragAndDrop();
}

// Drag & Drop (long-press) setup
let dragState = {
    active: false,
    type: null, // 'song' | 'playlist'
    id: null,
    ghost: null,
    startX: 0,
    startY: 0,
    longPressTimer: null,
    originEl: null
};

function wireDragAndDrop() {
    const songItems = songsList.querySelectorAll('.song-item');
    const playlistHeaders = songsList.querySelectorAll('.playlist-header');

    songItems.forEach(el => attachDraggable(el, 'song'));
    playlistHeaders.forEach(header => {
        const wrapper = header.parentElement;
        attachDraggable(wrapper, 'playlist', header);
    });

    // Root drop to move to root
    songsList.addEventListener('mouseup', handleRootDrop);
    songsList.addEventListener('touchend', handleRootDrop, { passive: false });
}

function attachDraggable(containerEl, type, handleEl = null) {
    const targetEl = handleEl || containerEl;
    const onMouseDown = (e) => startPress(e, containerEl, type);
    const onTouchStart = (e) => startPress(e.touches[0], containerEl, type, e);
    const onMouseUp = cancelPress;
    const onTouchEnd = cancelPress;
    targetEl.addEventListener('mousedown', onMouseDown);
    targetEl.addEventListener('touchstart', onTouchStart, { passive: false });
    targetEl.addEventListener('mouseup', onMouseUp);
    targetEl.addEventListener('touchend', onTouchEnd);
}

function startPress(pointEvent, el, type, rawEvent = null) {
    if (rawEvent) rawEvent.preventDefault();
    dragState.startX = pointEvent.clientX;
    dragState.startY = pointEvent.clientY;
    dragState.type = type;
    dragState.originEl = el;
    dragState.id = el.dataset.id;
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = setTimeout(() => beginDrag(pointEvent), 250);
    document.addEventListener('mousemove', maybeStartDrag);
    document.addEventListener('touchmove', maybeStartDragTouch, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag, { passive: false });
}

function maybeStartDrag(e) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 6) beginDrag(e);
}

function maybeStartDragTouch(e) {
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    const dx = t.clientX - dragState.startX;
    const dy = t.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 6) beginDrag(t);
}

function beginDrag(e) {
    if (dragState.active) return;
    clearTimeout(dragState.longPressTimer);
    dragState.active = true;
    // Create ghost
    dragState.ghost = document.createElement('div');
    dragState.ghost.className = 'drag-ghost';
    dragState.ghost.textContent = dragState.type === 'song' ? 'Song' : 'Playlist';
    document.body.appendChild(dragState.ghost);
    moveGhost(e.clientX, e.clientY);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMoveTouch, { passive: false });
}

function cancelPress() {
    clearTimeout(dragState.longPressTimer);
    document.removeEventListener('mousemove', maybeStartDrag);
    document.removeEventListener('touchmove', maybeStartDragTouch);
}

function onDragMove(e) {
    moveGhost(e.clientX, e.clientY);
    updateDropTargets(e.clientX, e.clientY);
}

function onDragMoveTouch(e) {
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    moveGhost(t.clientX, t.clientY);
    updateDropTargets(t.clientX, t.clientY);
    e.preventDefault();
}

function moveGhost(x, y) {
    if (!dragState.ghost) return;
    dragState.ghost.style.left = `${x + 12}px`;
    dragState.ghost.style.top = `${y + 12}px`;
}

function clearHighlights() {
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

function updateDropTargets(x, y) {
    clearHighlights();
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const songItem = el.closest('.song-item');
    const playlistHeader = el.closest('.playlist-header');
    if (dragState.type === 'song') {
        if (playlistHeader) playlistHeader.classList.add('drop-target');
        else if (songItem && songItem !== dragState.originEl) songItem.classList.add('drop-target');
        if (dragState.ghost) {
            if (playlistHeader) {
                const name = playlistHeader.parentElement?.dataset?.name || 'Playlist';
                dragState.ghost.textContent = `Move to: ${name}`;
            } else if (songItem && songItem !== dragState.originEl) {
                const title = songItem.dataset?.title || 'Song';
                dragState.ghost.textContent = `Group with: ${title}`;
            } else {
                dragState.ghost.textContent = 'Move to: Library';
            }
        }
    } else if (dragState.type === 'playlist') {
        if (playlistHeader) playlistHeader.classList.add('drop-target');
        if (dragState.ghost) {
            if (playlistHeader) {
                const name = playlistHeader.parentElement?.dataset?.name || 'Playlist';
                dragState.ghost.textContent = `Nest into: ${name}`;
            } else {
                dragState.ghost.textContent = 'Move to: Library';
            }
        }
    }
}

async function endDrag(e) {
    cancelPress();
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('touchmove', onDragMoveTouch);
    const ghost = dragState.ghost;
    dragState.ghost = null;
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);

    if (!dragState.active) {
        resetDragState();
        return;
    }
    dragState.active = false;

    const x = (e.changedTouches && e.changedTouches[0]?.clientX) || e.clientX;
    const y = (e.changedTouches && e.changedTouches[0]?.clientY) || e.clientY;
    const targetEl = document.elementFromPoint(x, y);
    const songItem = targetEl?.closest('.song-item');
    const playlistHeader = targetEl?.closest('.playlist-header');

    try {
        if (dragState.type === 'song') {
            if (playlistHeader) {
                const playlistId = playlistHeader.parentElement.dataset.id;
                await moveSongToPlaylist(dragState.id, playlistId);
                await cleanupEmptyPlaylists();
            } else if (songItem && songItem !== dragState.originEl) {
                // Create a new playlist with both songs
                const otherSongId = songItem.dataset.id;
                const otherSong = await idbGet('audio', otherSongId);
                const thisSong = await idbGet('audio', dragState.id);
                const newName = `${(thisSong.title || 'Song').slice(0, 12)} + ${(otherSong.title || 'Song').slice(0, 12)}`;
                // Place new playlist inside target song's parent playlist if exists
                const parentId = songItem.dataset.playlistId && songItem.dataset.playlistId !== 'root' ? songItem.dataset.playlistId : null;
                const pl = await createPlaylist({ name: newName, parentId });
                await moveSongToPlaylist(thisSong.id, pl.id);
                await moveSongToPlaylist(otherSong.id, pl.id);
                await cleanupEmptyPlaylists();
            } else if (songsList.contains(targetEl)) {
                // Drop to root
                await moveSongToPlaylist(dragState.id, null);
                await cleanupEmptyPlaylists();
            }
        } else if (dragState.type === 'playlist') {
            if (playlistHeader && playlistHeader.parentElement.dataset.id !== dragState.id) {
                const targetId = playlistHeader.parentElement.dataset.id;
                await movePlaylist(dragState.id, targetId);
                await cleanupEmptyPlaylists();
            } else if (songsList.contains(targetEl)) {
                await movePlaylist(dragState.id, null);
                await cleanupEmptyPlaylists();
            }
        }
    } finally {
        clearHighlights();
        resetDragState();
    }
}

function handleRootDrop(e) {
    // handled in endDrag when target is songsList
}

function resetDragState() {
    dragState = { active: false, type: null, id: null, ghost: null, startX: 0, startY: 0, longPressTimer: null, originEl: null };
}

async function loadSong(recordItem, shouldPlay = true) {
    try {
        stopAudio();
        songTitleElement.textContent = recordItem.title || 'UNKNOWN';
        songAuthorElement.textContent = recordItem.artist || 'UNNAMED';
        
        // Update last played ID
        await saveSetting('lastPlayedId', recordItem.id);
        
        // Handle background image
        if (recordItem.cover instanceof Blob) {
            const coverUrl = URL.createObjectURL(recordItem.cover);
            setCurrentRecordCover(coverUrl); // Use proper management instead of adding to song list URLs
            await updateRecordAppearance(coverUrl);
            // Don't store blob URLs in lastCoverUrl anymore
        } else {
            // Use the song's permanent gradient
            if (!recordItem.gradient) {
                // For older records without a gradient, generate and save one
                recordItem.gradient = generateRandomGradient();
                await idbPut('audio', recordItem);
            }
            await updateRecordAppearance(recordItem.gradient);
            // Store the gradient in lastCoverUrl since it's permanent
            await saveSetting('lastCoverUrl', recordItem.gradient);
        }
        
        await setupAudioPlayback(recordItem.file);
        if (shouldPlay) {
            handlePlayback();
        }
    } catch (e) {
        console.error('Error loading song:', e);
    }
}

// Import the InputHandler class
import InputHandler from './input-handler.js';

// Initialize the input handler (but don't set up its default event listeners)
const inputHandler = new InputHandler();
// We'll handle the UI interactions ourselves with the new combined interface

// Import the ContextMenu class
import ContextMenu from './context-menu.js';

// Initialize the context menu
const contextMenu = new ContextMenu(db);

// Lazy import/instantiate playlist context menu
let playlistContextMenuInstance = null;
async function ensurePlaylistContextMenu() {
    if (playlistContextMenuInstance) return playlistContextMenuInstance;
    const module = await import('./playlist-context-menu.js');
    playlistContextMenuInstance = new module.default(db, {
        onCreate: async (parentId) => {
            await createPlaylist({ name: null, parentId });
            await renderSongs();
        },
        onRename: async (id, name) => {
            await renamePlaylist(id, name);
            await renderSongs();
        },
        onDelete: async (id, options) => {
            await deletePlaylist(id, options);
            await renderSongs();
        },
        onMove: async (id, newParentId) => {
            await movePlaylist(id, newParentId);
            await renderSongs();
        }
    });
    window.playlistContextMenu = playlistContextMenuInstance;
    return playlistContextMenuInstance;
}

// Combined add music functionality
const addMusicPanel = document.querySelector('.add-music-panel');
const addMusicContent = document.querySelector('.add-music-content');
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const addSongInput = document.getElementById('add-song-url');
const addSongSubmitButton = document.getElementById('add-song-submit');
const musicPromptInput = document.getElementById('music-prompt');
const musicLengthSelect = document.getElementById('music-length');
const generateButton = document.getElementById('generate-button');
const loadingIndicator = document.querySelector('.loading-indicator');
const apiKeyInput = document.getElementById('elevenlabs-api-key');

// Load saved API key on form open
async function loadSavedApiKey() {
    try {
        const savedApiKey = await getSetting('elevenLabsApiKey');
        if (savedApiKey && apiKeyInput) {
            apiKeyInput.value = savedApiKey;
        }
    } catch (error) {
        console.error('Error loading saved API key:', error);
    }
}

// Save API key to IndexedDB
async function saveApiKey(apiKey) {
    try {
        await saveSetting('elevenLabsApiKey', apiKey);
    } catch (error) {
        console.error('Error saving API key:', error);
    }
}

// Toggle add music panel
if (addMusicPanel) {
    addMusicPanel.addEventListener('click', async (e) => {
        // Only toggle if clicking the main button, not the content
        if (e.target === addMusicPanel || e.target.classList.contains('add-music-button')) {
            const isExpanded = addMusicPanel.classList.contains('expanded');
            if (!isExpanded) {
                addMusicPanel.classList.add('expanded');
                await loadSavedApiKey();
                // Focus first input of active tab
                const activeTab = document.querySelector('.tab-content.active');
                const firstInput = activeTab.querySelector('input, textarea');
                if (firstInput) firstInput.focus();
            } else {
                addMusicPanel.classList.remove('expanded');
            }
        }
    });
}

// Prevent panel from closing when clicking inside content
if (addMusicContent) {
    addMusicContent.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

// Handle tab switching
tabButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetTab = button.dataset.tab;
        
        // Update active tab button
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update active tab content
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.classList.contains(`${targetTab}-tab`)) {
                content.classList.add('active');
                // Focus first input of newly active tab
                const firstInput = content.querySelector('input, textarea');
                if (firstInput) firstInput.focus();
            }
        });
    });
});

// Save API key when user types
if (apiKeyInput) {
    apiKeyInput.addEventListener('input', async (e) => {
        const apiKey = e.target.value.trim();
        if (apiKey) {
            await saveApiKey(apiKey);
        }
    });
}

// Handle YouTube/URL submission
if (addSongSubmitButton) {
    addSongSubmitButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = addSongInput.value.trim();
        if (!url) {
            errorHandler.showWarning('Please enter a YouTube or audio URL.', {
                title: 'Input Required',
                duration: 4000
            });
            addSongInput.focus();
            return;
        }

        try {
            // Use the existing input handler functionality
            if (inputHandler) {
                if (inputHandler.isYouTubeUrl(url)) {
                    await inputHandler.handleYouTubeUrl(url);
                } else {
                    await inputHandler.handleDirectAudioUrl(url);
                }
                
                // Clear input and close panel
                addSongInput.value = '';
                addMusicPanel.classList.remove('expanded');
                
                // Close songs panel if open
                if (songsPanel && songsPanel.classList.contains('open')) {
                    songsPanel.classList.remove('open');
                    songsPanel.setAttribute('aria-hidden', 'true');
                }
            }
        } catch (error) {
            console.error('Error processing URL:', error);
            errorHandler.showError('Failed to process the URL. Please make sure it\'s a valid audio file link.', {
                title: 'URL Processing Failed',
                duration: 6000
            });
        }
    });
}

// Handle Enter key in URL input
if (addSongInput) {
    addSongInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSongSubmitButton.click();
        } else if (e.key === 'Escape') {
            addSongInput.value = '';
            addMusicPanel.classList.remove('expanded');
        }
    });
}

// Handle keyboard shortcuts for music generation
if (musicPromptInput) {
    musicPromptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            generateButton.click();
        } else if (e.key === 'Escape') {
            musicPromptInput.value = '';
            addMusicPanel.classList.remove('expanded');
        }
    });
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (addMusicPanel && addMusicPanel.classList.contains('expanded')) {
        // Check if click is outside the panel
        if (!addMusicPanel.contains(e.target)) {
            addMusicPanel.classList.remove('expanded');
        }
    }
});

// Prevent panel from closing when interacting with form elements
const formElements = document.querySelectorAll('.add-music-content input, .add-music-content textarea, .add-music-content select, .add-music-content button');
formElements.forEach(element => {
    element.addEventListener('click', (e) => {
        e.stopPropagation();
    });
});

// Handle form submission
const aiGenerationForm = document.querySelector('.ai-generation-form');
if (aiGenerationForm) {
    aiGenerationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        generateButton.click();
    });
}

// AI Generation State Management
let aiGenerationState = {
    isGenerating: false,
    startTime: null,
    estimatedDuration: 0,
    progressInterval: null,
    timeoutId: null,
    abortController: null
};

// AI Generation DOM Elements
const aiOverlay = document.getElementById('ai-generation-overlay');
const aiText = document.getElementById('ai-generation-text');
const aiSubtext = document.getElementById('ai-generation-subtext');
const aiProgressFill = document.getElementById('ai-progress-fill');
const aiProgressText = document.getElementById('ai-progress-text');
const aiCancelButton = document.getElementById('ai-cancel-button');

// Silly loading messages
const loadingMessages = [
    { main: "brb pestering the music magician", sub: "conjuring your sonic masterpiece..." },
    { main: "tickling the sound waves", sub: "teaching notes to dance together..." },
    { main: "whispering sweet melodies", sub: "into the digital void..." },
    { main: "bribing the rhythm fairies", sub: "with virtual cookies..." },
    { main: "negotiating with the beat", sub: "it's driving a hard bargain..." },
    { main: "summoning audio spirits", sub: "from the ethereal soundscape..." }
];

function showAiGenerationOverlay(estimatedSeconds) {
    // Random silly message
    const message = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
    
    aiText.textContent = message.main;
    aiSubtext.textContent = message.sub;
    aiProgressText.textContent = `estimated time: ${estimatedSeconds}s`;
    
    // Reset progress
    aiProgressFill.style.width = '0%';
    aiCancelButton.classList.remove('visible');
    
    // Show overlay
    aiOverlay.classList.add('active');
}

function hideAiGenerationOverlay() {
    aiOverlay.classList.remove('active');
    
    // Clear intervals and timeouts
    if (aiGenerationState.progressInterval) {
        clearInterval(aiGenerationState.progressInterval);
        aiGenerationState.progressInterval = null;
    }
    if (aiGenerationState.timeoutId) {
        clearTimeout(aiGenerationState.timeoutId);
        aiGenerationState.timeoutId = null;
    }
}

function updateProgress(elapsedSeconds, estimatedSeconds, isNearEnd = false) {
    let progressPercent;
    
    if (isNearEnd && elapsedSeconds >= estimatedSeconds * 0.95) {
        // Slow down progress dramatically near the end
        const overtime = elapsedSeconds - (estimatedSeconds * 0.95);
        const maxOvertime = estimatedSeconds * 0.5; // Allow 50% overtime
        const overtimeProgress = Math.min(overtime / maxOvertime, 1) * 5; // Very slow progress
        progressPercent = Math.min(95 + overtimeProgress, 99.5);
    } else {
        // Normal progress until 95%
        progressPercent = Math.min((elapsedSeconds / estimatedSeconds) * 95, 95);
    }
    
    aiProgressFill.style.width = `${progressPercent}%`;
    
    // Update time text
    const remaining = Math.max(0, estimatedSeconds - elapsedSeconds);
    if (remaining > 0) {
        aiProgressText.textContent = `estimated time: ${Math.ceil(remaining)}s`;
    } else {
        aiProgressText.textContent = "almost there...";
    }
}

function startProgressTracking(estimatedSeconds) {
    aiGenerationState.startTime = Date.now();
    aiGenerationState.estimatedDuration = estimatedSeconds;
    
    // Update progress every 100ms for smooth animation
    aiGenerationState.progressInterval = setInterval(() => {
        const elapsed = (Date.now() - aiGenerationState.startTime) / 1000;
        const isNearEnd = elapsed >= estimatedSeconds * 0.95;
        updateProgress(elapsed, estimatedSeconds, isNearEnd);
    }, 100);
    
    // Show cancel button after 1 minute
    aiGenerationState.timeoutId = setTimeout(() => {
        aiCancelButton.classList.add('visible');
        aiSubtext.textContent = "taking longer than expected...";
    }, 60000);
}

function cancelGeneration() {
    if (aiGenerationState.abortController) {
        aiGenerationState.abortController.abort();
    }
    
    aiGenerationState.isGenerating = false;
    hideAiGenerationOverlay();
    
    // Reset button state
    generateButton.disabled = false;
    generateButton.textContent = 'Generate';
    
    errorHandler.showWarning('Music generation was cancelled.', {
        title: 'Generation Cancelled',
        duration: 3000
    });
}

// Handle cancel button click
if (aiCancelButton) {
    aiCancelButton.addEventListener('click', cancelGeneration);
}

// Handle music generation
if (generateButton) {
    generateButton.addEventListener('click', async (e) => {
        e.preventDefault();
        
        // Prevent multiple simultaneous generations
        if (aiGenerationState.isGenerating) return;
        
        const prompt = musicPromptInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            errorHandler.showWarning('Please enter your ElevenLabs API key first.', {
                title: 'API Key Required',
                duration: 4000
            });
            apiKeyInput.focus();
            return;
        }
        
        if (!prompt) {
            errorHandler.showWarning('Please enter a description for the music you want to generate.', {
                title: 'Description Required',
                duration: 4000
            });
            musicPromptInput.focus();
            return;
        }

        const length = parseInt(musicLengthSelect.value);
        const estimatedSeconds = Math.ceil(length / 1000) * 2; // 2x the audio length
        
        try {
            // Save API key for future use
            await saveApiKey(apiKey);
            
            // Set generation state
            aiGenerationState.isGenerating = true;
            aiGenerationState.abortController = new AbortController();
            
            // Update button state
            generateButton.disabled = true;
            generateButton.textContent = 'Generating...';
            
            // Show AI generation overlay
            showAiGenerationOverlay(estimatedSeconds);
            startProgressTracking(estimatedSeconds);
            
            // Close add music panel
            addMusicPanel.classList.remove('expanded');

            const response = await fetch('/api/generate-music', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    length: length,
                    apiKey: apiKey
                }),
                signal: aiGenerationState.abortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json();
                // Pass the full error object to preserve type and other properties
                const error = new Error(errorData.message || errorData.error || 'Music generation failed');
                error.type = errorData.type;
                error.statusCode = errorData.statusCode;
                error.promptSuggestion = errorData.promptSuggestion;
                throw error;
            }

            // Complete the progress bar
            aiProgressFill.style.width = '100%';
            aiProgressText.textContent = 'processing audio...';

            // Get the generated audio as blob
            const blob = await response.blob();
            const file = new File([blob], `generated-${Date.now()}.mp3`, { type: 'audio/mpeg' });

            // Process the generated audio file
            await processGeneratedMusic(file, prompt);

            // Reset form
            musicPromptInput.value = '';
            
            // Close songs panel if open
            if (songsPanel && songsPanel.classList.contains('open')) {
                songsPanel.classList.remove('open');
                songsPanel.setAttribute('aria-hidden', 'true');
            }

        } catch (error) {
            console.error('Music generation error:', error);
            
            // Don't show error if it was cancelled
            if (error.name !== 'AbortError') {
                // Use the new error handling system
                errorHandler.showError(error, {
                    title: 'Music Generation Failed',
                    duration: 10000
                });
            }
        } finally {
            // Reset generation state
            aiGenerationState.isGenerating = false;
            hideAiGenerationOverlay();
            
            // Reset button state
            generateButton.disabled = false;
            generateButton.textContent = 'Generate';
        }
    });
}

// Process generated music file
async function processGeneratedMusic(file, prompt) {
    try {
        // Clear any existing error toasts to prevent confusion
        errorHandler.clearAll();
        
        // Stop any currently playing audio cleanly
        stopAudio();

        // Generate ID and create metadata
        const id = await computeFileId(file);
        const gradient = generateRandomGradient();

        // Generate creative title and author using the free LLM service
        let title = 'Generated Music';
        let artist = 'AI Artist';
        let coverImageBlob = null;
        
        try {
            // Generate metadata and cover image in parallel
            const [metadataResponse, coverImageResponse] = await Promise.allSettled([
                fetch('/api/generate-song-metadata', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ prompt })
                }),
                fetch('/api/generate-cover-image', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ prompt })
                })
            ]);
            
            // Handle metadata response
            if (metadataResponse.status === 'fulfilled' && metadataResponse.value.ok) {
                const metadata = await metadataResponse.value.json();
                if (metadata.title) title = metadata.title;
                if (metadata.author) artist = metadata.author;
            } else if (metadataResponse.status === 'fulfilled' && metadataResponse.value.status === 429) {
                console.log('LLM service rate limited, using fallback metadata');
            } else {
                console.warn('LLM metadata generation failed, using fallback');
            }
            
            // Handle cover image response
            if (coverImageResponse.status === 'fulfilled' && coverImageResponse.value.ok) {
                const imageBlob = await coverImageResponse.value.blob();
                if (imageBlob && imageBlob.size > 0) {
                    coverImageBlob = imageBlob;
                    console.log('Generated cover image successfully:', imageBlob.size, 'bytes');
                } else {
                    console.warn('Cover image generation returned empty data');
                }
            } else {
                console.warn('Cover image generation failed, will use gradient fallback');
                if (coverImageResponse.status === 'fulfilled') {
                    console.warn('Cover image error status:', coverImageResponse.value.status);
                }
            }
        } catch (error) {
            console.warn('Error calling generation services:', error);
            // Use fallback values already set above
        }

        // Store in IndexedDB with proper metadata
        const audioRecord = {
            id,
            file,
            title: title,
            artist: artist,
            cover: coverImageBlob, // Use generated cover image if available
            gradient: gradient, // Keep gradient as fallback
            createdAt: Date.now(),
            isGenerated: true // Flag to identify generated music
        };
        await idbPut('audio', audioRecord);

        // Update UI immediately with smooth transition
        songTitleElement.textContent = audioRecord.title;
        songAuthorElement.textContent = audioRecord.artist;
        
        // Update record appearance with generated cover or gradient fallback
        if (coverImageBlob) {
            const coverUrl = URL.createObjectURL(coverImageBlob);
            setCurrentRecordCover(coverUrl); // Properly manage the record cover URL
            await updateRecordAppearance(coverUrl);
        } else {
            await updateRecordAppearance(gradient);
        }

        // Set up audio playback with error handling
        try {
            await setupAudioPlayback(file);
            
            // Wait a moment for audio to be ready, then start playback
            setTimeout(() => {
                handlePlayback().catch(playbackError => {
                    console.warn('Playback started automatically after generation:', playbackError);
                    // Don't throw error for autoplay issues, just log it
                });
            }, 100);
            
        } catch (audioError) {
            console.error('Error setting up audio playback:', audioError);
            // Don't throw - the music was generated successfully, just can't play immediately
            errorHandler.showWarning('Music generated successfully but couldn\'t start playing automatically. Click the record to play.', {
                title: 'Playback Issue',
                duration: 4000
            });
        }

        // Refresh songs list to show the new track
        renderSongs();

        // Show success message with a delay to avoid overlapping with the overlay
        setTimeout(() => {
            errorHandler.showSuccess(`"${audioRecord.title}" conjured successfully! 🎵`, {
                duration: 4000
            });
        }, 500);

    } catch (error) {
        console.error('Error processing generated music:', error);
        // Re-throw to be handled by the calling function
        throw error;
    }
}

// Remove old input handling code
if (songsButton && songsPanel) {
    songsButton.addEventListener('click', async () => {
        const isOpen = songsPanel.classList.contains('open');
        if (!isOpen) {
            renderSongs();
            songsPanel.classList.add('open');
            songsPanel.setAttribute('aria-hidden', 'false');
        } else {
            songsPanel.classList.remove('open');
            songsPanel.setAttribute('aria-hidden', 'true');
            // Revoke created URLs to avoid leaks
            setTimeout(clearSongObjectUrls, 0);
        }
    });
}

// Make functions available globally 
window.processAudioFile = processAudioFile;
window.renderSongs = renderSongs;
window.getSetting = getSetting;
window.updateRecordAppearance = updateRecordAppearance;
window.createPlaylist = createPlaylist;
window.renamePlaylist = renamePlaylist;
window.deletePlaylist = deletePlaylist;
window.moveSongToPlaylist = moveSongToPlaylist;
window.movePlaylist = movePlaylist;
window.updatePlaylist = updatePlaylist;

// Cleanup empty playlists (recursively remove playlists with no songs and no child playlists)
async function cleanupEmptyPlaylists() {
    const [playlists, songs] = await Promise.all([
        idbGetAll('playlists'),
        idbGetAll('audio')
    ]);
    if (!playlists.length) {
        await renderSongs();
        return;
    }
    const songsByPl = new Map();
    for (const s of songs) {
        const key = s.playlistId || null;
        songsByPl.set(key, (songsByPl.get(key) || 0) + 1);
    }
    const childrenByPl = new Map();
    for (const p of playlists) {
        const key = p.parentId || null;
        childrenByPl.set(key, (childrenByPl.get(key) || 0) + 1);
    }
    // Iteratively delete empties (affects parents becoming empty after children removed)
    let deletedAny = false;
    const toDelete = new Set();
    while (true) {
        let found = false;
        for (const p of playlists) {
            if (toDelete.has(p.id)) continue;
            const songCount = songsByPl.get(p.id) || 0;
            // Children count excluding those already marked for deletion
            let childCount = 0;
            for (const c of playlists) {
                if (toDelete.has(c.id)) continue;
                if ((c.parentId || null) === p.id) childCount++;
            }
            if (songCount === 0 && childCount === 0) {
                toDelete.add(p.id);
                found = true;
            }
        }
        if (!found) break;
        deletedAny = true;
        // Apply deletions
        for (const id of toDelete) {
            // Only delete once
            const idx = playlists.findIndex(pp => pp.id === id);
            if (idx !== -1) {
                await idbDelete('playlists', id);
            }
        }
        break; // One pass is enough since we recompute parent childCount above excluding toDelete
    }
    if (deletedAny) {
        await renderSongs();
    } else {
        await renderSongs();
    }
}
window.cleanupEmptyPlaylists = cleanupEmptyPlaylists;
