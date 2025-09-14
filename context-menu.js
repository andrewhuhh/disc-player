export default class ContextMenu {
    constructor(db) {
        this.db = db;
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu';
        this.menu.style.zIndex = '100000';
        document.body.appendChild(this.menu);

        // Close menu on any click outside
        document.addEventListener('click', (e) => {
            if (!this.menu.contains(e.target)) {
                this.hide();
            }
        });

        // Close menu on scroll
        document.addEventListener('scroll', () => this.hide());

        // Prevent default context menu on our menu
        this.menu.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    show(x, y, songData) {
        this.menu.innerHTML = `
            <div class="context-menu-item" data-action="edit">
                <i class="fas fa-edit"></i>
                Edit
            </div>
            <div class="context-menu-item" data-action="queue">
                <i class="fas fa-list"></i>
                Add to Queue
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item delete" data-action="delete">
                <i class="fas fa-trash"></i>
                Delete
            </div>
        `;

        // Position the menu
        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.style.display = 'block';

        // Adjust position if menu would go off screen
        const menuRect = this.menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (menuRect.right > viewportWidth) {
            this.menu.style.left = `${x - menuRect.width}px`;
        }
        if (menuRect.bottom > viewportHeight) {
            this.menu.style.top = `${y - menuRect.height}px`;
        }

        // Add click handlers for menu items
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                this.handleAction(action, songData);
                this.hide();
            });
        });
    }

    hide() {
        this.menu.style.display = 'none';
    }

    isEditDialogOpen() {
        return document.querySelector('.edit-dialog') !== null;
    }

    async handleAction(action, songData) {
        switch (action) {
            case 'queue':
                // TODO: Implement queue functionality
                console.log('Add to queue:', songData);
                break;

            case 'edit':
                this.showEditDialog(songData);
                break;

            case 'delete':
                this.showDeleteConfirmation(songData);
                break;
        }
    }

    showEditDialog = (songData) => {
        const dialog = document.createElement('div');
        dialog.className = 'edit-dialog';
        dialog.innerHTML = `
            <div class="edit-dialog-content">
                <div class="edit-form">
                    <div class="edit-layout">
                        <div class="edit-cover-section">
                            <label for="cover">Cover</label>
                            <div class="custom-file-upload">
                                <div class="cover-preview" ${songData.cover instanceof Blob ? `style="background-image: url('${URL.createObjectURL(songData.cover)}')"` : ''}>
                                    <div class="cover-overlay">
                                        <i class="fas fa-camera"></i>
                                        <span>Change Cover</span>
                                    </div>
                                </div>
                                <input type="file" id="cover" accept="image/*" class="cover-input" />
                            </div>
                        </div>
                        <div class="edit-fields-section">
                            <div class="form-group">
                                <label for="title">Title</label>
                                <input type="text" id="title" value="${songData.title || ''}" />
                            </div>
                            <div class="form-group">
                                <label for="artist">Artist</label>
                                <input type="text" id="artist" value="${songData.artist || ''}" />
                            </div>
                            <div class="dialog-buttons">
                                <button class="cancel-btn">Cancel</button>
                                <button class="save-btn">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Add event listeners
        const cancelBtn = dialog.querySelector('.cancel-btn');
        const saveBtn = dialog.querySelector('.save-btn');
        const titleInput = dialog.querySelector('#title');
        const artistInput = dialog.querySelector('#artist');
        const coverInput = dialog.querySelector('#cover');
        const coverPreview = dialog.querySelector('.cover-preview');

        // Create object URL for existing cover if it exists
        let existingCoverUrl = null;
        if (songData.cover instanceof Blob) {
            existingCoverUrl = URL.createObjectURL(songData.cover);
        }

        // Add cover preview functionality
        let newCoverUrl = null;
        coverInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                // Clean up previous preview URL if it exists
                if (newCoverUrl) {
                    URL.revokeObjectURL(newCoverUrl);
                }
                const file = e.target.files[0];
                newCoverUrl = URL.createObjectURL(file);
                coverPreview.style.backgroundImage = `url('${newCoverUrl}')`;
            }
        });

        // Cleanup function for object URLs
        const cleanup = () => {
            if (existingCoverUrl) {
                URL.revokeObjectURL(existingCoverUrl);
            }
            if (newCoverUrl) {
                URL.revokeObjectURL(newCoverUrl);
            }
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            document.body.removeChild(dialog);
        });

        saveBtn.addEventListener('click', async () => {
            try {
                const updatedSong = { ...songData };
                updatedSong.title = titleInput.value.trim() || 'UNKNOWN';
                updatedSong.artist = artistInput.value.trim() || 'UNNAMED';

                if (coverInput.files.length > 0) {
                    const file = coverInput.files[0];
                    updatedSong.cover = file;
                }

                // Use window.db to access the global database instance
                const tx = window.db.transaction(['audio'], 'readwrite');
                const store = tx.objectStore('audio');
                await store.put(updatedSong);

                // Refresh the songs list and update current song if it's the one being edited
                await window.renderSongs();
                const currentId = await window.getSetting('lastPlayedId');
                if (currentId === songData.id) {
                    window.songTitleElement.textContent = updatedSong.title;
                    window.songAuthorElement.textContent = updatedSong.artist;
                    if (updatedSong.cover instanceof Blob) {
                        const coverUrl = URL.createObjectURL(updatedSong.cover);
                        await window.updateRecordAppearance(coverUrl);
                        URL.revokeObjectURL(coverUrl);
                    }
                }

                cleanup();
                document.body.removeChild(dialog);
            } catch (error) {
                console.error('Error updating song:', error);
                cleanup();
            }
        });
    }

    showDeleteConfirmation = (songData) => {
        const dialog = document.getElementById('delete-confirmation-dialog');
        const titleElement = document.getElementById('delete-song-title');
        const artistElement = document.getElementById('delete-song-artist');
        const cancelBtn = dialog.querySelector('.delete-cancel-btn');
        const confirmBtn = dialog.querySelector('.delete-confirm-btn');

        // Update dialog content with song information
        titleElement.textContent = songData.title || 'UNKNOWN';
        artistElement.textContent = songData.artist || 'UNNAMED';

        // Show the dialog
        dialog.classList.add('active');

        // Remove existing event listeners to prevent duplicates
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newConfirmBtn = confirmBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

        // Add event listeners
        newCancelBtn.addEventListener('click', () => {
            dialog.classList.remove('active');
        });

        newConfirmBtn.addEventListener('click', async () => {
            try {
                const tx = window.db.transaction(['audio'], 'readwrite');
                const store = tx.objectStore('audio');
                await store.delete(songData.id);
                
                // Refresh the songs list
                await window.renderSongs();
                
                // Close the dialog
                dialog.classList.remove('active');
                
                // Show success message
                if (window.errorHandler) {
                    window.errorHandler.showSuccess(`"${songData.title || 'Song'}" deleted successfully.`, {
                        duration: 3000
                    });
                }
            } catch (error) {
                console.error('Error deleting song:', error);
                if (window.errorHandler) {
                    window.errorHandler.showError('Failed to delete song. Please try again.', {
                        title: 'Delete Failed',
                        duration: 5000
                    });
                }
            }
        });

        // Close dialog when clicking outside
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                dialog.classList.remove('active');
            }
        });

        // Close dialog with Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                dialog.classList.remove('active');
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }
} 