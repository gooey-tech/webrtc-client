import { EventEmitter } from 'events';
import SimplePeer from 'simple-peer';
import { io, Socket } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed to [socket.io-client `io()`](https://socket.io/docs/v4/client-options/). */
export type SocketIoClientOptions = Partial<ManagerOptions & SocketOptions>;

export type SignalingState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';
export type PeerState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'destroyed'
  | 'error';

export enum ConnectionState {
  IDLE = 'idle',
  SIGNALING_CONNECTING = 'signaling:connecting',
  SIGNALING_CONNECTED = 'signaling:connected',
  PEER_CONNECTING = 'peer:connecting',
  PEER_CONNECTED = 'peer:connected',
  DISCONNECTED = 'disconnected',
  FAILED = 'failed',
}

export interface WebRTCState {
  connectionState: ConnectionState;
  signalingState: SignalingState;
  peerState: PeerState;
  socketId: string | null;
  peerId: string | null;
  error: Error | null;
}

export interface WebRTCClientConfig {
  signalingUrl: string;
  peerOptions?: SimplePeer.Options;
  /** When true (default), automatically create an answerer peer on incoming signal. */
  autoAccept?: boolean;
  /**
   * Merged into socket.io-client options. Default keeps `transports: ['websocket']`
   * unless you override `transports`.
   */
  socketOptions?: SocketIoClientOptions;
  /**
   * Called right after `SimplePeer` is constructed, before listeners are attached.
   * Use to patch the underlying `RTCPeerConnection` (e.g. React Native `getStats`).
   */
  onPeerCreated?: (peer: SimplePeer.Instance) => void;
}

export interface WebRTCClientEvents {
  stateChange: (state: Readonly<WebRTCState>) => void;
  connectionStateChange: (state: ConnectionState) => void;
  signalingStateChange: (state: SignalingState) => void;
  peerStateChange: (state: PeerState) => void;
  data: (data: Uint8Array | string) => void;
  stream: (stream: MediaStream) => void;
  incomingPeer: (peerId: string) => void;
  error: (error: Error) => void;
  close: () => void;
}

interface SignalPayload {
  from: string;
  signal: SimplePeer.SignalData;
}

// ---------------------------------------------------------------------------
// Typed emitter helper
// ---------------------------------------------------------------------------

type EventKey = keyof WebRTCClientEvents;

declare interface TypedEmitter {
  on<K extends EventKey>(event: K, listener: WebRTCClientEvents[K]): this;
  once<K extends EventKey>(event: K, listener: WebRTCClientEvents[K]): this;
  off<K extends EventKey>(event: K, listener: WebRTCClientEvents[K]): this;
  emit<K extends EventKey>(
    event: K,
    ...args: Parameters<WebRTCClientEvents[K]>
  ): boolean;
  removeAllListeners(event?: EventKey): this;
}

// ---------------------------------------------------------------------------
// WebRTCClient
// ---------------------------------------------------------------------------

class WebRTCClient extends (EventEmitter as new () => TypedEmitter) {
  private readonly config: Required<Pick<WebRTCClientConfig, 'autoAccept'>> &
    WebRTCClientConfig;
  private _state: WebRTCState;
  private socket: Socket | null = null;
  private peer: SimplePeer.Instance | null = null;
  private pendingSignal: SimplePeer.SignalData | null = null;

  constructor(config: WebRTCClientConfig) {
    super();
    this.config = { autoAccept: true, ...config };
    this._state = {
      connectionState: ConnectionState.IDLE,
      signalingState: 'disconnected',
      peerState: 'idle',
      socketId: null,
      peerId: null,
      error: null,
    };
  }

  // ---- Getters ------------------------------------------------------------

  get state(): Readonly<WebRTCState> {
    return Object.freeze({ ...this._state });
  }

  get socketId(): string | null {
    return this._state.socketId;
  }

  get connectionState(): ConnectionState {
    return this._state.connectionState;
  }

  get isConnected(): boolean {
    return this._state.peerState === 'connected';
  }

  // ---- Public methods -----------------------------------------------------

  connect(): void {
    if (this.socket) return;

    this.setState({ signalingState: 'connecting', error: null });

    const socketOpts = this.config.socketOptions ?? {};
    this.socket = io(this.config.signalingUrl, {
      ...socketOpts,
      transports: socketOpts.transports ?? ['websocket'],
    });

    this.socket.on('connect', () => {
      this.setState({
        signalingState: 'connected',
        socketId: this.socket!.id ?? null,
      });
    });

    this.socket.on('disconnect', () => {
      this.destroyPeer();
      this.setState({ signalingState: 'disconnected', socketId: null });
    });

    this.socket.on('connect_error', (err: Error) => {
      this.setState({ signalingState: 'error', error: err });
      this.emit('error', err);
    });

    this.socket.on('signal', (data: SignalPayload) => {
      this.handleIncomingSignal(data);
    });
  }

  connectToPeer(targetSocketId: string): void {
    if (this._state.signalingState !== 'connected') {
      throw new Error(
        `Cannot connect to peer: signaling is "${this._state.signalingState}"`,
      );
    }
    if (this._state.peerState !== 'idle') {
      throw new Error(
        `Cannot connect to peer: peer state is "${this._state.peerState}"`,
      );
    }

    this.setState({ peerId: targetSocketId });
    this.createPeer(true);
  }

  acceptPeer(peerId: string): void {
    if (this._state.peerState !== 'idle') {
      throw new Error(
        `Cannot accept peer: peer state is "${this._state.peerState}"`,
      );
    }

    this.setState({ peerId });
    this.createPeer(false);

    if (this.pendingSignal) {
      this.peer!.signal(this.pendingSignal);
      this.pendingSignal = null;
    }
  }

  send(data: string | Uint8Array): void {
    if (!this.peer || this._state.peerState !== 'connected') {
      throw new Error('Cannot send: peer is not connected');
    }
    this.peer.send(data);
  }

  addStream(stream: MediaStream): void {
    if (!this.peer) throw new Error('Cannot add stream: no active peer');
    this.peer.addStream(stream);
  }

  removeStream(stream: MediaStream): void {
    if (!this.peer) throw new Error('Cannot remove stream: no active peer');
    this.peer.removeStream(stream);
  }

  disconnectPeer(): void {
    this.destroyPeer();
    this.setState({ peerState: 'idle', peerId: null, error: null });
  }

  disconnect(): void {
    this.destroyPeer();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.setState({
      signalingState: 'disconnected',
      peerState: 'idle',
      socketId: null,
      peerId: null,
      error: null,
    });
  }

  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }

  // ---- Private methods ----------------------------------------------------

  private createPeer(initiator: boolean): void {
    const { peerOptions, onPeerCreated } = this.config;

    this.peer = new SimplePeer({
      initiator,
      trickle: true,
      ...peerOptions,
    });

    onPeerCreated?.(this.peer);

    this.setState({ peerState: 'connecting' });

    this.peer.on('signal', (signal: SimplePeer.SignalData) => {
      this.socket?.emit('signal', {
        to: this._state.peerId,
        signal,
      });
    });

    this.peer.on('connect', () => {
      this.setState({ peerState: 'connected' });
    });

    this.peer.on('data', (data: Uint8Array) => {
      this.emit('data', data);
    });

    this.peer.on('stream', (stream: MediaStream) => {
      this.emit('stream', stream);
    });

    this.peer.on('close', () => {
      this.destroyPeer();
      this.setState({ peerState: 'idle', peerId: null });
      this.emit('close');
    });

    this.peer.on('error', (err: Error) => {
      const isAbort = /close called|user-initiated abort/i.test(err.message);
      if (!isAbort) {
        this.destroyPeer();
        this.setState({ peerState: 'idle', peerId: null, error: null });
        this.emit('error', err);
      }
    });
  }

  private handleIncomingSignal(data: SignalPayload): void {
    const { from, signal } = data;

    if (this.peer && this._state.peerId === from) {
      this.peer.signal(signal);
      return;
    }

    if (!this.peer) {
      if (this.config.autoAccept) {
        this.setState({ peerId: from });
        this.createPeer(false);
        this.peer!.signal(signal);
      } else {
        this.pendingSignal = signal;
        this.emit('incomingPeer', from);
      }
    }
  }

  private destroyPeer(): void {
    if (this.peer) {
      this.peer.removeAllListeners();
      this.peer.destroy();
      this.peer = null;
    }
    this.pendingSignal = null;
  }

  private deriveConnectionState(
    signalingState: SignalingState,
    peerState: PeerState,
  ): ConnectionState {
    if (signalingState === 'error' || peerState === 'error')
      return ConnectionState.FAILED;
    if (peerState === 'connected') return ConnectionState.PEER_CONNECTED;
    if (peerState === 'connecting') return ConnectionState.PEER_CONNECTING;
    if (peerState === 'destroyed') return ConnectionState.DISCONNECTED;
    if (signalingState === 'connected')
      return ConnectionState.SIGNALING_CONNECTED;
    if (signalingState === 'connecting')
      return ConnectionState.SIGNALING_CONNECTING;
    return ConnectionState.IDLE;
  }

  private setState(
    partial: Partial<
      Pick<
        WebRTCState,
        'signalingState' | 'peerState' | 'socketId' | 'peerId' | 'error'
      >
    >,
  ): void {
    const prevSignaling = this._state.signalingState;
    const prevPeer = this._state.peerState;
    const prevConnection = this._state.connectionState;

    Object.assign(this._state, partial);
    this._state.connectionState = this.deriveConnectionState(
      this._state.signalingState,
      this._state.peerState,
    );

    this.emit('stateChange', this.state);

    if (this._state.connectionState !== prevConnection) {
      this.emit('connectionStateChange', this._state.connectionState);
    }
    if (this._state.signalingState !== prevSignaling) {
      this.emit('signalingStateChange', this._state.signalingState);
    }
    if (this._state.peerState !== prevPeer) {
      this.emit('peerStateChange', this._state.peerState);
    }
  }
}

export { WebRTCClient };
