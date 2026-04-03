import { WebRTCClient, ConnectionState } from '../src';

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

const setStatus = (state: string) => {
  elements.status.dataset.state = state;
  elements.status.textContent = state;
};

const resetUI = () => {
  elements.myId.value = '';
  elements.connectButton.disabled = false;
  elements.disconnectButton.disabled = true;
  elements.peerButton.disabled = true;
  elements.dropPeerButton.disabled = true;
  elements.sendButton.disabled = true;
};

const wireClient = (c: WebRTCClient) => {
  c.on('connectionStateChange', (state) => {
    setStatus(state);
    appendLog(`State: ${state}`);
  });

  c.on('signalingStateChange', (state) => {
    if (state === 'connected') {
      elements.myId.value = c.socketId ?? '';
      elements.connectButton.disabled = true;
      elements.disconnectButton.disabled = false;
      elements.peerButton.disabled = false;
      appendLog(`Socket ID: ${c.socketId}`, 'ok');
    }
    if (state === 'disconnected') {
      resetUI();
    }
  });

  c.on('peerStateChange', (state) => {
    const hasPeer = state === 'connecting' || state === 'connected';
    elements.peerButton.disabled = hasPeer;
    elements.dropPeerButton.disabled = !hasPeer;
    elements.sendButton.disabled = state !== 'connected';

    if (state === 'idle') {
      elements.peerButton.disabled = false;
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
  setStatus(ConnectionState.IDLE);
  resetUI();
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
