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
        };

        request.onsuccess = async (event) => {
            db = event.target.result;
            window.db = db; // Make db globally accessible
            console.log('Database initialized successfully');
            
            // Verify stores exist
            if (!db.objectStoreNames.contains('audio') || !db.objectStoreNames.contains('settings')) {
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

// Set up canvas for visualization
canvas = document.createElement('canvas');
canvas.className = 'audio-visualizer';
document.body.appendChild(canvas);

// Ensure canvas has fixed size
function resizeCanvas() {
    // Size for bottom bar visualizer
    canvas.width = window.innerWidth;
    canvas.height = 80;
    
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
async function processAudioFile(file) {
    try {
        // Stop any currently playing audio
        stopAudio();

        // Compute ID and extract metadata
        const [id, metadata] = await Promise.all([
            computeFileId(file),
            extractMetadata(file)
        ]);

        // Generate a permanent gradient if no cover art
        const gradient = !metadata.coverBlob ? generateRandomGradient() : null;

        // Store in IndexedDB (upsert without clearing)
        const audioRecord = {
            id,
            file,
            title: metadata.title,
            artist: metadata.artist,
            cover: metadata.coverBlob || null,
            gradient: gradient, // Store permanent gradient if no cover
            createdAt: Date.now()
        };
        await idbPut('audio', audioRecord);

        // Update UI appearance and text
        songTitleElement.textContent = metadata.title || 'UNKNOWN';
        songAuthorElement.textContent = metadata.artist || 'UNNAMED';
        if (metadata.coverUrl) {
            updateRecordAppearance(metadata.coverUrl);
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
            
            // Get and play next song
            const currentId = await getSetting('lastPlayedId');
            const nextSong = await getNextSong(currentId);
            
            if (nextSong) {
                await loadSong(nextSong, true); // Load and play the next song
            }
        });
        
        currentAudio.addEventListener('loadeddata', () => {
            console.log('Audio loaded and ready to play');
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
        } else {
            // Play the audio
            await currentAudio.play();
            isPlaying = true;
            startRotation();
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
    }
}



// Simple center-split mirrored bar visualizer at the bottom
function drawVisualization(forceDraw = false) {
    if (!analyzer || (!isPlaying && !isScrubbing)) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - lastDrawTime;
    
    // Apply frame rate limiting
    const targetInterval = isScrubbing ? FRAME_INTERVAL : NORMAL_FRAME_INTERVAL;
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
                // Restart visualization
                drawVisualization();
            }).catch(err => console.error('Error resuming playback:', err));
        }
    }

    isScrubbing = false;
}

// Songs UI logic
function clearSongObjectUrls() {
    songCoverObjectUrls.forEach(url => URL.revokeObjectURL(url));
    songCoverObjectUrls = [];
}

async function renderSongs() {
    if (!db || !songsList) return;
    clearSongObjectUrls();
    const items = await idbGetAll('audio');
    // Sort newest first
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    songsList.innerHTML = '';
    
    // Create all song items first without animation class
    for (const item of items) {
        const wrapper = document.createElement('div');
        wrapper.className = 'song-item';
        wrapper.dataset.id = item.id;
        wrapper.tabIndex = 0; // Make focusable
        wrapper.setAttribute('role', 'button'); // For accessibility
        wrapper.setAttribute('aria-label', `Play ${item.title || 'Unknown'} by ${item.artist || 'Unnamed'}`);

        const cover = document.createElement('div');
        cover.className = 'song-cover';
        if (item.cover instanceof Blob) {
            const url = URL.createObjectURL(item.cover);
            songCoverObjectUrls.push(url);
            cover.style.backgroundImage = `url('${url}')`;
        } else {
            // Use the song's permanent gradient or generate one if it doesn't exist
            if (!item.gradient) {
                item.gradient = generateRandomGradient();
                await idbPut('audio', item);
            }
            cover.style.backgroundImage = item.gradient;
        }

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

        // Add click handler for playing the song
        wrapper.addEventListener('click', async () => {
            await loadSong(item);
            // Close panel after selecting
            if (songsPanel) {
                songsPanel.classList.remove('open');
                songsPanel.setAttribute('aria-hidden', 'true');
            }
        });

        // Add context menu handler
        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            contextMenu.show(e.clientX, e.clientY, item);
        });

        songsList.appendChild(wrapper);
    }

    // Animate items from bottom to top with delays
    const songItems = Array.from(songsList.querySelectorAll('.song-item'));
    const DELAY_INCREMENT = 50; // 50ms between each animation
    const BASE_DELAY = 10; // Start first animation after 100ms

    // Reverse the array to start from bottom
    songItems.reverse().forEach((item, index) => {
        setTimeout(() => {
            item.classList.add('animate');
        }, BASE_DELAY + (index * DELAY_INCREMENT));
    });
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
            songCoverObjectUrls.push(coverUrl);
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

// Initialize the input handler
const inputHandler = new InputHandler();

// Import the ContextMenu class
import ContextMenu from './context-menu.js';

// Initialize the context menu
const contextMenu = new ContextMenu(db);

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
