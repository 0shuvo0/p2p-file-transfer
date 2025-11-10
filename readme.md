# WebRTC P2P File Transfer

A simple, lightweight library for peer-to-peer file transfer using WebRTC and Socket.IO. Transfer files directly between browsers without uploading to a server!

## Features

- 🚀 Direct peer-to-peer file transfer
- 📦 Minimal server setup (just Socket.IO signaling)
- 📊 Progress tracking
- 🔄 Automatic chunking for large files
- 🌐 NAT traversal with STUN servers
- 💪 Works with any file type and size

## Installation

```bash
npm install webrtc-p2p-file-transfer
```

### Download 
[Download the latest release](https://raw.githubusercontent.com/0shuvo0/p2p-file-transfer/refs/heads/main/p2p-file-transfer.js)

## How It Works

1. Two peers connect to a Socket.IO signaling server
2. Sender initiates WebRTC connection and opens data channel
3. File is sent in chunks directly between peers (no server upload!)
4. Receiver assembles chunks back into the original file

## Complete Example

### Backend (Node.js + Socket.IO)

```javascript
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files (your frontend)
app.use(express.static('public'));

// Handle WebRTC signaling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Forward WebRTC signals between peers
  socket.on('signal', (message) => {
    io.to(message.to).emit('signal', {
      from: socket.id,
      data: message.data
    });
  });

  // Notify others when someone disconnects
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Frontend (HTML + JavaScript)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>P2P File Transfer</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
    }
    .section {
      margin: 20px 0;
      padding: 20px;
      border: 1px solid #ddd;
      border-radius: 5px;
    }
    button {
      padding: 10px 20px;
      margin: 5px;
      cursor: pointer;
    }
    #progress {
      width: 100%;
      height: 30px;
      margin: 10px 0;
    }
    #status {
      padding: 10px;
      margin: 10px 0;
      background: #f0f0f0;
      border-radius: 3px;
    }
    .peer-list {
      margin: 10px 0;
    }
    .peer-item {
      padding: 10px;
      margin: 5px 0;
      background: #e8f4f8;
      border-radius: 3px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <h1>P2P File Transfer Demo</h1>
  
  <div class="section">
    <h2>Your ID: <span id="myId">Connecting...</span></h2>
    <div id="status">Status: Initializing...</div>
  </div>

  <div class="section">
    <h2>Send File</h2>
    <input type="file" id="fileInput">
    <br><br>
    <label>Recipient ID: <input type="text" id="targetId" placeholder="Enter peer ID"></label>
    <br><br>
    <button onclick="sendFile()">Send File</button>
    <br>
    <progress id="progress" value="0" max="100"></progress>
    <div id="progressText">Ready to send</div>
  </div>

  <div class="section">
    <h2>Received Files</h2>
    <div id="receivedFiles">No files received yet</div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/p2p-file-transfer.js"></script>
  <script>
    // Connect to Socket.IO server
    const socket = io('http://localhost:3000');
    let fileTransfer;

    socket.on('connect', () => {
      document.getElementById('myId').textContent = socket.id;
      document.getElementById('status').textContent = 'Status: Connected';
      
      // Initialize file transfer
      fileTransfer = new P2PFileTransfer(socket, 'signal', {
        onProgress: (sent, total) => {
          const percent = (sent / total * 100).toFixed(1);
          document.getElementById('progress').value = percent;
          document.getElementById('progressText').textContent = 
            `Progress: ${percent}% (${formatBytes(sent)} / ${formatBytes(total)})`;
        },
        
        onComplete: (blob, fileName, peerId) => {
          // Create download link for received file
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.textContent = `Download ${fileName} (${formatBytes(blob.size)})`;
          a.style.display = 'block';
          a.style.margin = '10px 0';
          
          const container = document.getElementById('receivedFiles');
          if (container.textContent === 'No files received yet') {
            container.textContent = '';
          }
          container.appendChild(a);
          
          document.getElementById('status').textContent = 
            `Status: Received ${fileName} from ${peerId}`;
        },
        
        onError: (error) => {
          console.error('Transfer error:', error);
          document.getElementById('status').textContent = 
            `Status: Error - ${error.message}`;
        },
        
        onConnectionStateChange: (peerId, state) => {
          console.log(`Connection with ${peerId}: ${state}`);
        }
      });
    });

    socket.on('disconnect', () => {
      document.getElementById('status').textContent = 'Status: Disconnected';
    });

    async function sendFile() {
      const fileInput = document.getElementById('fileInput');
      const targetId = document.getElementById('targetId').value.trim();
      
      if (!fileInput.files.length) {
        alert('Please select a file');
        return;
      }
      
      if (!targetId) {
        alert('Please enter recipient ID');
        return;
      }
      
      const file = fileInput.files[0];
      document.getElementById('status').textContent = 
        `Status: Sending ${file.name} to ${targetId}...`;
      
      try {
        await fileTransfer.sendFile(targetId, file);
      } catch (error) {
        console.error('Send error:', error);
      }
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
  </script>
</body>
</html>
```

## API Reference

### Constructor

```javascript
const fileTransfer = new P2PFileTransfer(socket, signalEvent, callbacks);
```

**Parameters:**
- `socket` - Socket.IO client instance
- `signalEvent` - Event name for WebRTC signaling (e.g., 'signal')
- `callbacks` - Object with callback functions:
  - `onProgress(sent, total)` - Called during file transfer
  - `onComplete(blob, fileName, peerId)` - Called when file is received
  - `onError(error)` - Called on errors
  - `onConnectionStateChange(peerId, state)` - Called on connection state changes

### Methods

#### `sendFile(targetId, file)`

Send a file to another peer.

```javascript
await fileTransfer.sendFile('socket-id-here', fileObject);
```

#### `destroy()`

Close all connections and cleanup.

```javascript
fileTransfer.destroy();
```

## Usage Tips

1. **Get the recipient's Socket ID**: Both peers need to know each other's socket ID to initiate transfer
2. **Firewall/NAT**: The library uses Google's STUN servers for NAT traversal. Most transfers work, but some restrictive networks may need TURN servers
3. **Large files**: Files are automatically chunked into 16KB pieces for efficient transfer
4. **Security**: For production, implement authentication and validate peer connections

## Browser Support

- Chrome/Edge 56+
- Firefox 44+
- Safari 11+
- Opera 43+

## License

MIT

## Contributing

Pull requests are welcome! For major changes, please open an issue first.

## Support

If you encounter issues, please file them on GitHub Issues.