/**
 * P2P File Transfer Library using WebRTC and Socket.IO
 * Enables peer-to-peer file sharing with minimal backend setup
 */

class P2PFileTransfer {
    constructor(socket, signalEvent, callbacks = {}) {
        this.socket = socket;
        this.signalEvent = signalEvent;
        this.callbacks = {
            onError: callbacks.onError || ((err) => console.error(err)),
            onProgress: callbacks.onProgress || (() => {}),
            onComplete: callbacks.onComplete || (() => {}),
            onConnectionStateChange: callbacks.onConnectionStateChange || (() => {})
        };

        // Store active peer connections
        this.peers = new Map();
        
        // Chunk size for file transfer (16KB)
        this.chunkSize = 16384;
        
        // ICE servers for NAT traversal
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Listen for incoming signals
        this.socket.on(this.signalEvent, this._handleSignal.bind(this));
    }

    /**
     * Send a file to a peer
     * @param {string} targetId - Socket ID of the recipient
     * @param {File} file - File object to send
     */
    async sendFile(targetId, file) {
        try {
            const pc = await this._getOrCreatePeerConnection(targetId, true);
            const dataChannel = pc.createDataChannel('fileTransfer');
            
            this._setupDataChannel(dataChannel, file, true);
            
            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this._sendSignal(targetId, {
                type: 'offer',
                sdp: offer,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type
            });
        } catch (err) {
            this.callbacks.onError(err);
        }
    }

    /**
     * Get existing peer connection or create new one
     */
    async _getOrCreatePeerConnection(peerId, isInitiator) {
        if (this.peers.has(peerId)) {
            return this.peers.get(peerId).pc;
        }

        const pc = new RTCPeerConnection(this.iceServers);
        const peerData = {
            pc,
            isInitiator,
            receivedChunks: [],
            receivedBytes: 0,
            fileMetadata: null
        };

        this.peers.set(peerId, peerData);

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendSignal(peerId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            this.callbacks.onConnectionStateChange(peerId, pc.connectionState);
            
            if (pc.connectionState === 'disconnected' || 
                pc.connectionState === 'failed' || 
                pc.connectionState === 'closed') {
                this._cleanupPeer(peerId);
            }
        };

        // Handle incoming data channel (for receiver)
        pc.ondatachannel = (event) => {
            this._setupDataChannel(event.channel, null, false, peerId);
        };

        return pc;
    }

    /**
     * Setup data channel for sending or receiving
     */
    _setupDataChannel(channel, file, isSender, peerId = null) {
        if (isSender) {
            // Sender logic
            channel.onopen = async () => {
                await this._sendFileInChunks(channel, file);
            };

            channel.onerror = (error) => {
                this.callbacks.onError(error);
            };
        } else {
            // Receiver logic
            const peerData = this.peers.get(peerId);
            
            channel.onmessage = async (event) => {
                if (typeof event.data === 'string') {
                    // Metadata message
                    const metadata = JSON.parse(event.data);
                    if (metadata.type === 'metadata') {
                        peerData.fileMetadata = metadata;
                    } else if (metadata.type === 'end') {
                        this._assembleFile(peerId);
                    }
                } else {
                    // Binary chunk
                    peerData.receivedChunks.push(event.data);
                    peerData.receivedBytes += event.data.byteLength;
                    
                    if (peerData.fileMetadata) {
                        this.callbacks.onProgress(
                            peerData.receivedBytes,
                            peerData.fileMetadata.fileSize
                        );
                    }
                }
            };

            channel.onerror = (error) => {
                this.callbacks.onError(error);
            };
        }
    }

    /**
     * Send file in chunks through data channel
     */
    async _sendFileInChunks(channel, file) {
        // Send metadata first
        const metadata = {
            type: 'metadata',
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
        };
        channel.send(JSON.stringify(metadata));

        let offset = 0;
        const reader = new FileReader();

        const readSlice = () => {
            const slice = file.slice(offset, offset + this.chunkSize);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (event) => {
            if (channel.readyState === 'open') {
                channel.send(event.target.result);
                offset += event.target.result.byteLength;
                
                this.callbacks.onProgress(offset, file.size);

                if (offset < file.size) {
                    // Wait a bit if buffer is getting full
                    if (channel.bufferedAmount > this.chunkSize * 10) {
                        setTimeout(readSlice, 100);
                    } else {
                        readSlice();
                    }
                } else {
                    // Send end signal
                    channel.send(JSON.stringify({ type: 'end' }));
                }
            }
        };

        readSlice();
    }

    /**
     * Assemble received chunks into a file
     */
    _assembleFile(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData || !peerData.fileMetadata) return;

        const blob = new Blob(peerData.receivedChunks, { 
            type: peerData.fileMetadata.fileType 
        });

        this.callbacks.onComplete(
            blob,
            peerData.fileMetadata.fileName,
            peerId
        );

        // Cleanup
        this._cleanupPeer(peerId);
    }

    /**
     * Handle incoming WebRTC signals
     */
    async _handleSignal(message) {
        const { from, data } = message;

        try {
            if (data.type === 'offer') {
                const pc = await this._getOrCreatePeerConnection(from, false);
                
                // Store file metadata
                const peerData = this.peers.get(from);
                peerData.fileMetadata = {
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                    fileType: data.fileType
                };

                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                this._sendSignal(from, {
                    type: 'answer',
                    sdp: answer
                });

            } else if (data.type === 'answer') {
                const peerData = this.peers.get(from);
                if (peerData) {
                    await peerData.pc.setRemoteDescription(
                        new RTCSessionDescription(data.sdp)
                    );
                }

            } else if (data.type === 'ice-candidate') {
                const peerData = this.peers.get(from);
                if (peerData) {
                    await peerData.pc.addIceCandidate(
                        new RTCIceCandidate(data.candidate)
                    );
                }
            }
        } catch (err) {
            this.callbacks.onError(err);
        }
    }

    /**
     * Send signal through Socket.IO
     */
    _sendSignal(to, data) {
        this.socket.emit(this.signalEvent, { to, data });
    }

    /**
     * Cleanup peer connection
     */
    _cleanupPeer(peerId) {
        const peerData = this.peers.get(peerId);
        if (peerData) {
            peerData.pc.close();
            this.peers.delete(peerId);
        }
    }

    /**
     * Close all peer connections
     */
    destroy() {
        this.peers.forEach((peerData, peerId) => {
            this._cleanupPeer(peerId);
        });
        this.socket.off(this.signalEvent);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    // Node.js / CommonJS
    module.exports = P2PFileTransfer;
}

if (typeof window !== 'undefined') {
    // Browser global
    window.P2PFileTransfer = P2PFileTransfer;
}