import { WebRTCClient, ConnectionState, type WebRTCState } from '../src';

type TagName<S extends string> =
  S extends `${infer T}#${string}` ? T :
  S extends `${infer T}.${string}` ? T :
  S;

type ElementFor<S extends string> =
  TagName<S> extends keyof HTMLElementTagNameMap
    ? HTMLElementTagNameMap[TagName<S>]
    : HTMLElement;

function $<S extends string>(selector: S): ElementFor<S> {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element as ElementFor<S>;
}

const elements = {
  log: $('div#log'),
  status: $('div#status'),
  serverUrl: $('input#serverUrl'),
  myId: $('input#myId'),
  remoteId: $('input#remoteId'),
  messageInput: $('input#msgInput'),
  connectButton: $('button#btnConnect'),
  disconnectButton: $('button#btnDisconnect'),
  peerButton: $('button#btnPeer'),
  dropPeerButton: $('button#btnDropPeer'),
  sendButton: $('button#btnSend'),
};

const appendLog = (message: string, level = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  elements.log.innerHTML += `<span class="ts">${timestamp}</span> <span class="${level}">${message}</span>\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
};

let client: WebRTCClient | null = null;

const renderState = (state: WebRTCState) => {
  const { connectionState, signalingState, peerState, socketId } = state;

  elements.status.dataset.state = connectionState;
  elements.status.textContent = connectionState;

  elements.myId.value = socketId ?? '';

  const signalingUp = signalingState === 'connected';
  const hasPeer = peerState === 'connecting' || peerState === 'connected';

  elements.connectButton.disabled = signalingUp;
  elements.disconnectButton.disabled = !signalingUp;
  elements.peerButton.disabled = !signalingUp || hasPeer;
  elements.dropPeerButton.disabled = !hasPeer;
  elements.sendButton.disabled = peerState !== 'connected';
};

const wireClient = (c: WebRTCClient) => {
  c.on('stateChange', renderState);

  c.on('connectionStateChange', (state) => {
    appendLog(`State: ${state}`);
  });

  c.on('signalingStateChange', (state) => {
    if (state === 'connected') {
      appendLog(`Socket ID: ${c.socketId}`, 'ok');
    }
  });

  c.on('incomingPeer', (peerId) => {
    elements.remoteId.value = peerId;
    appendLog(`Incoming peer: ${peerId}`, 'info');
  });

  c.on('data', (data) => {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    appendLog(`Peer: ${text}`, 'info');
  });

  c.on('error', (error) => {
    appendLog(`Error: ${error.message}`, 'err');
  });

  c.on('close', () => {
    appendLog('Peer connection closed');
  });
};

// ---- Connect --------------------------------------------------------------

elements.connectButton.addEventListener('click', () => {
  const url = elements.serverUrl.value.trim();
  if (!url) return;

  client = new WebRTCClient({ signalingUrl: url });
  wireClient(client);
  client.connect();
});

// ---- Disconnect -----------------------------------------------------------

elements.disconnectButton.addEventListener('click', () => {
  client?.destroy();
  client = null;
  appendLog('Disconnected');
});

// ---- Peer connect / drop --------------------------------------------------

elements.peerButton.addEventListener('click', () => {
  const remoteId = elements.remoteId.value.trim();
  if (!remoteId) return appendLog('Enter a remote socket ID', 'err');
  client?.connectToPeer(remoteId);
});

elements.dropPeerButton.addEventListener('click', () => {
  client?.disconnectPeer();
  appendLog('Peer dropped');
});

// ---- Send message ---------------------------------------------------------

const sendMessage = () => {
  const text = elements.messageInput.value.trim();
  if (!text || !client?.isConnected) return;
  client.send(text);
  appendLog(`You: ${text}`, 'ok');
  elements.messageInput.value = '';
};

elements.sendButton.addEventListener('click', sendMessage);
elements.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendMessage();
});
