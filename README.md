# Your Record Player

A modern web-based music player with YouTube integration, AI music generation, and local storage. Built with vanilla JavaScript and designed to work seamlessly on both desktop and mobile devices.

## ✨ Features

- **🎧 YouTube Integration**: Convert YouTube videos to MP3 with automatic metadata extraction
- **🤖 AI Music Generation**: Generate custom music using ElevenLabs API
- **💾 Local Storage**: All music stored locally using IndexedDB (no server required)
- **📱 Responsive Design**: Beautiful interface that works on all devices
- **🎨 Visual Audio**: Real-time audio visualization during playback
- **📋 Playlist Management**: Create and organize playlists with drag-and-drop
- **🔄 Offline Support**: Works completely offline once music is loaded

## 🚀 Quick Start

### Local Development

1. **Clone the repository**:
```bash
git clone <your-repo-url>
cd disc-player
```

2. **Install dependencies**:

First, install yt-dlp:
- **Windows**: `winget install yt-dlp` or download from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
- **macOS**: `brew install yt-dlp`
- **Linux**: `sudo apt install yt-dlp` or `sudo dnf install yt-dlp`

Then install Node.js dependencies:
```bash
npm install
```

3. **Start the development server**:
```bash
npm run dev
```

4. **Open your browser** and go to `http://localhost:3000`

### Deployment

1. **Frontend (Netlify)**:
   - Connect your GitHub repository to Netlify
   - Build command: `npm install`
   - Publish directory: `.`

2. **Backend (Render)**:
   - Connect your GitHub repository to Render
   - Build command: `npm install`
   - Start command: `node server.js`
   - Environment: Node.js

## 🎮 How to Use

### Adding Music

1. **YouTube Videos**: Paste a YouTube URL in the input field and click "Add Song"
2. **Direct Audio**: Paste a direct link to an audio file (MP3, WAV, etc.)
3. **AI Generation**: Enter a description and generate custom music (requires ElevenLabs API key)

### Controls

- **Click the record** to play/pause
- **Spacebar** to play/pause (when not in input fields)
- **Tab** to open/close the songs panel
- **Arrow keys** to navigate through songs
- **Drag the record** to scrub through the track
- **Right-click** on songs for context menu options

### Playlists

- **Create playlists** by right-clicking in the songs panel
- **Drag songs** to playlists to organize them
- **Nest playlists** by dragging one playlist into another
- **Rename/delete** playlists using the context menu

## 🛠️ Technical Details

### Architecture

- **Frontend**: Vanilla JavaScript with modern ES6+ features
- **Storage**: IndexedDB for local music and playlist storage
- **Audio Processing**: Web Audio API for visualization and playback
- **Backend**: Node.js server on Render for API functionality
- **Styling**: Pure CSS with custom properties and animations

### Browser Support

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

### File Structure

```
├── assets/                # Static assets
├── index.html            # Main HTML file
├── script.js             # Main application logic
├── input-handler.js      # Input handling
├── context-menu.js       # Context menu functionality
├── styles.css            # All styles
├── server.js             # Main API server
└── netlify.toml          # Netlify frontend configuration
```

## 🔧 Configuration

### Environment Variables

- `NODE_ENV`: Set to `production` for production builds
- `ELEVENLABS_API_KEY`: Your ElevenLabs API key for music generation

### API Keys

1. **ElevenLabs**: Get your API key from [ElevenLabs](https://elevenlabs.io)
2. **Add to Netlify**: Set as environment variable in your Netlify dashboard

## 🐛 Troubleshooting

### Common Issues

1. **YouTube download fails**: Check if yt-dlp is installed and in your system PATH
2. **Audio not playing**: Ensure your browser supports the audio format
3. **Storage issues**: Clear browser data if IndexedDB becomes corrupted
4. **Permission errors**: Ensure you have write permissions in the temp directory

### Debug Mode

Open browser developer tools and check the console for detailed error messages.

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- **ElevenLabs** for AI music generation
- **YouTube** for video content
- **Netlify** for hosting and serverless functions
- **Web Audio API** for audio processing
