export default class PlaylistContextMenu {
    constructor(db, handlers = {}) {
        this.db = db;
        this.handlers = handlers;
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu';
        this.menu.style.zIndex = '100000';
        document.body.appendChild(this.menu);

        document.addEventListener('click', (e) => {
            if (!this.menu.contains(e.target)) this.hide();
        });
        document.addEventListener('scroll', () => this.hide());
        this.menu.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    show(x, y, playlist) {
        this.menu.innerHTML = `
            <div class="context-menu-item" data-action="new">
                <i class="fas fa-folder-plus"></i>
                New Playlist Inside
            </div>
            <div class="context-menu-item" data-action="edit">
                <i class="fas fa-edit"></i>
                Edit
            </div>
            <div class="context-menu-item" data-action="move-up">
                <i class="fas fa-level-up-alt"></i>
                Move Out One Level
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item delete" data-action="delete">
                <i class="fas fa-trash"></i>
                Delete Playlist
            </div>
        `;

        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.style.display = 'block';

        const menuRect = this.menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (menuRect.right > vw) this.menu.style.left = `${x - menuRect.width}px`;
        if (menuRect.bottom > vh) this.menu.style.top = `${y - menuRect.height}px`;

        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                await this.handleAction(action, playlist);
                this.hide();
            });
        });
    }

    hide() { this.menu.style.display = 'none'; }

    async handleAction(action, playlist) {
        switch (action) {
            case 'new':
                return this.handlers.onCreate?.(playlist.id);
            case 'edit':
                return this.showEditDialog(playlist);
            case 'move-up':
                return this.handlers.onMove?.(playlist.id, playlist.parentId ? null : null);
            case 'delete': {
                const keep = confirm('Delete playlist only and keep songs? Press OK to keep songs, Cancel to delete songs.');
                return this.handlers.onDelete?.(playlist.id, { deleteSongs: !keep });
            }
        }
    }

    showEditDialog(playlist) {
        const dialog = document.createElement('div');
        dialog.className = 'edit-dialog';
        const coverUrl = playlist.cover instanceof Blob ? URL.createObjectURL(playlist.cover) : '';
        dialog.innerHTML = `
            <div class="edit-dialog-content">
                <div class="edit-form">
                    <div class="edit-layout">
                        <div class="edit-cover-section">
                            <label for="pl-cover">Cover</label>
                            <div class="custom-file-upload">
                                <div class="cover-preview" ${coverUrl ? `style="background-image: url('${coverUrl}')"` : ''}>
                                    <div class="cover-overlay">
                                        <i class="fas fa-camera"></i>
                                        <span>Change Cover</span>
                                    </div>
                                </div>
                                <input type="file" id="pl-cover" accept="image/*" class="cover-input" />
                            </div>
                        </div>
                        <div class="edit-fields-section">
                            <div class="form-group">
                                <label for="pl-name">Name</label>
                                <input type="text" id="pl-name" value="${playlist.name || ''}" />
                            </div>
                            <div class="form-group">
                                <label for="pl-desc">Description</label>
                                <input type="text" id="pl-desc" value="${playlist.description || ''}" />
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

        const cancelBtn = dialog.querySelector('.cancel-btn');
        const saveBtn = dialog.querySelector('.save-btn');
        const nameInput = dialog.querySelector('#pl-name');
        const descInput = dialog.querySelector('#pl-desc');
        const coverInput = dialog.querySelector('#pl-cover');
        const coverPreview = dialog.querySelector('.cover-preview');

        let newCoverUrl = null;
        coverInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                if (newCoverUrl) URL.revokeObjectURL(newCoverUrl);
                newCoverUrl = URL.createObjectURL(e.target.files[0]);
                coverPreview.style.backgroundImage = `url('${newCoverUrl}')`;
            }
        });

        const cleanup = () => {
            if (coverUrl) URL.revokeObjectURL(coverUrl);
            if (newCoverUrl) URL.revokeObjectURL(newCoverUrl);
        };

        cancelBtn.addEventListener('click', () => {
            cleanup();
            document.body.removeChild(dialog);
        });

        saveBtn.addEventListener('click', async () => {
            try {
                const updates = {
                    name: nameInput.value.trim() || playlist.name || 'Playlist',
                    description: descInput.value.trim() || ''
                };
                if (coverInput.files.length > 0) {
                    updates.cover = coverInput.files[0];
                }
                await window.updatePlaylist(playlist.id, updates);
                await window.renderSongs();
                cleanup();
                document.body.removeChild(dialog);
            } catch (err) {
                console.error('Error updating playlist:', err);
                cleanup();
            }
        });
    }
}


