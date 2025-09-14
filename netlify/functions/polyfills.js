// Web API polyfills for Node.js environment
const { Blob } = require('buffer');
const { EventEmitter } = require('events');

// Basic File implementation
class File extends Blob {
    constructor(bits, name, options = {}) {
        super(bits, options);
        this.name = name;
        this.lastModified = options.lastModified || Date.now();
    }
}

// Export polyfills
module.exports = {
    File,
    Blob,
    // Add other required web API polyfills
    Headers: class Headers extends Map {},
    ReadableStream: class ReadableStream extends EventEmitter {
        constructor(source) {
            super();
            this._source = source;
        }
    }
};
