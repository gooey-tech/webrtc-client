# @gooey-tech/webrtc-client

TypeScript WebRTC client with observable connection state, built on [simple-peer](https://github.com/feross/simple-peer) and [socket.io-client](https://socket.io/docs/v4/client-api/).

Designed to pair with [gooey-tech/signaling-server](https://github.com/gooey-tech/signaling-server).

## Install

```bash
npm install @gooey-tech/webrtc-client
```

## Quick Start

```typescript
import { WebRTCClient, ConnectionState } from '@gooey-tech/webrtc-client';

const client = new WebRTCClient({
  signalingUrl: 'https://your-signaling-server.com',
});

client.on('connectionStateChange', (state) => {
  console.log('Connection state:', state);
});

client.on('data', (data) => {
  console.log('Received:', data);
});

// Connect to signaling server
client.connect();

// Initiate a peer connection (you need the target's socket ID)
client.connectToPeer('target-socket-id');

// Send data once connected
client.on('peerStateChange', (state) => {
  if (state === 'connected') {
    client.send('hello from the other side');
  }
});
```

## Connection States

The client exposes two independent state axes and one derived composite:

### `ConnectionState` (derived enum)

| Value | Meaning |
|---|---|
| `IDLE` | Not connected to anything |
| `SIGNALING_CONNECTING` | Socket connecting to signaling server |
| `SIGNALING_CONNECTED` | Socket connected, no peer yet |
| `PEER_CONNECTING` | WebRTC signaling in progress |
| `PEER_CONNECTED` | Peer data channel open |
| `DISCONNECTED` | Was connected, closed cleanly |
| `FAILED` | Signaling or peer error |

### `signalingState`

`disconnected` | `connecting` | `connected` | `error`

### `peerState`

`idle` | `connecting` | `connected` | `destroyed` | `error`

## API

### `new WebRTCClient(config)`

```typescript
interface WebRTCClientConfig {
  signalingUrl: string;
  peerOptions?: SimplePeer.Options; // ICE servers, streams, etc.
  autoAccept?: boolean;             // default: true
}
```

When `autoAccept` is `true` (default), incoming peer signals automatically create an answerer. Set to `false` to handle incoming connections manually via the `incomingPeer` event and `acceptPeer()`.

### Methods

| Method | Description |
|---|---|
| `connect()` | Connect to the signaling server |
| `connectToPeer(socketId)` | Initiate a peer connection to a target socket ID |
| `acceptPeer(peerId)` | Manually accept an incoming peer (when `autoAccept: false`) |
| `send(data)` | Send string or binary data over the data channel |
| `addStream(stream)` | Add a `MediaStream` to the peer connection |
| `removeStream(stream)` | Remove a `MediaStream` from the peer connection |
| `disconnectPeer()` | Destroy the peer but stay connected to signaling |
| `disconnect()` | Full teardown (peer + signaling) |
| `destroy()` | `disconnect()` + remove all event listeners |

### Events

| Event | Payload | Description |
|---|---|---|
| `stateChange` | `WebRTCState` | Fired on any state mutation |
| `connectionStateChange` | `ConnectionState` | Derived composite state changed |
| `signalingStateChange` | `SignalingState` | Signaling axis changed |
| `peerStateChange` | `PeerState` | Peer axis changed |
| `data` | `Uint8Array \| string` | Data received from peer |
| `stream` | `MediaStream` | Remote media stream received |
| `incomingPeer` | `string` (peerId) | Incoming peer when `autoAccept: false` |
| `error` | `Error` | Signaling or peer error |
| `close` | — | Peer connection closed |

### Properties

| Property | Type | Description |
|---|---|---|
| `state` | `Readonly<WebRTCState>` | Frozen snapshot of full state |
| `socketId` | `string \| null` | Local socket ID |
| `connectionState` | `ConnectionState` | Current derived state |
| `isConnected` | `boolean` | `true` when peer is connected |

## Running the Example

A browser-based demo is included in `example/`. It uses the `WebRTCClient` class directly, bundled with esbuild.

```bash
# Build and serve with live reload
npm run example:dev
```

This opens a dev server at `http://localhost:8000`. To test peer-to-peer:

1. Open two browser tabs to `http://localhost:8000`
2. In both tabs, set the signaling server URL (e.g. `https://signaling-server-jr8j.onrender.com`) and click **Connect**
3. Copy the **My Socket ID** from one tab into the **Remote Socket ID** field of the other
4. Click **Connect to Peer** — both tabs should transition to `PEER:CONNECTED`
5. Type a message and hit **Send** — it arrives on the other tab over the WebRTC data channel

To build the example without serving:

```bash
npm run example:build
```

## Signaling Server

This client is built for [gooey-tech/signaling-server](https://github.com/gooey-tech/signaling-server) — a minimal Socket.io relay that forwards `signal` events between peers by socket ID. No rooms, no lobby, just direct relay.

## License

MIT
