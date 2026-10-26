import http from 'http';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Launch server
import('./server.js').then(async () => {
  console.log('Local static server started');

  // 2. Launch Edge with remote debugging
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--enable-webgl',
    '--window-size=1440,960',
    'http://localhost:3000'
  ]);

  edge.stderr.on('data', d => {
    // console.log('Edge stderr:', d.toString());
  });

  // Wait for remote debugging endpoint to become ready
  let endpoint = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      const list = await res.json();
      if (list && list.length > 0) {
        endpoint = list.find(t => t.type === 'page') || list[0];
        break;
      }
    } catch (e) {}
  }

  if (!endpoint) {
    console.error('Failed to connect to Edge remote debugging endpoint');
    edge.kill();
    process.exit(1);
  }

  console.log('Connected to Edge page target:', endpoint.title, endpoint.url);

  const ws = new WebSocket(endpoint.webSocketDebuggerUrl);
  let id = 1;
  const callbacks = new Map();

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      callbacks.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg.result);
      callbacks.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map(a => a.value !== undefined ? a.value : JSON.stringify(a)).join(' ');
      console.log(`[BROWSER CONSOLE ${msg.params.type.toUpperCase()}]:`, args);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]:', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails);
    }
  };

  ws.onopen = async () => {
    console.log('WebSocket connected to Edge CDP');

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');

    // Wait 3.5 seconds for Three.js, textures, and fly-in animation
    await new Promise(r => setTimeout(r, 3500));

    // Evaluate window.app state
    const evalRes = await send('Runtime.evaluate', {
      expression: `({
        hasApp: !!window.app,
        viewState: window.app ? window.app.viewState : null,
        canvasPresent: !!document.querySelector('#webgl-container canvas'),
        canvasWidth: document.querySelector('#webgl-container canvas')?.width,
        canvasHeight: document.querySelector('#webgl-container canvas')?.height,
        overlayTransform: document.querySelector('#dom-panel-overlay')?.style?.transform,
        piecesCount: window.app ? Object.keys(window.app.shardPieces).length : 0
      })`,
      returnByValue: true
    });

    console.log('\n--- APPLICATION DIAGNOSTICS ---');
    console.log(JSON.stringify(evalRes.result?.value, null, 2));

    // Capture hero screenshot via CDP
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) {
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.join(__dirname, 'cdp-hero-screenshot.png'), buf);
      console.log(`Saved screenshot: cdp-hero-screenshot.png (${buf.length} bytes)`);
    }

    // Test clicking "Read paper & story"
    console.log('\nTriggering Shatter transition in browser...');
    await send('Runtime.evaluate', {
      expression: `window.app.triggerShatter('chapters');`
    });

    await new Promise(r => setTimeout(r, 1400));

    // Diagnostics after shatter
    const shatterEval = await send('Runtime.evaluate', {
      expression: `({
        viewState: window.app.viewState,
        defViewOpacity: document.querySelector('#definitions-view')?.style?.opacity,
        defTitle: document.querySelector('#def-title')?.textContent,
        sliverOpacity: document.querySelector('#sliver-back-btn')?.style?.opacity
      })`,
      returnByValue: true
    });
    console.log('--- POST-SHATTER DIAGNOSTICS ---');
    console.log(JSON.stringify(shatterEval.result?.value, null, 2));

    const shotShatter = await send('Page.captureScreenshot', { format: 'png' });
    if (shotShatter && shotShatter.data) {
      const buf = Buffer.from(shotShatter.data, 'base64');
      fs.writeFileSync(path.join(__dirname, 'cdp-shatter-screenshot.png'), buf);
      console.log(`Saved screenshot: cdp-shatter-screenshot.png (${buf.length} bytes)`);
    }

    // Test clicking Back
    console.log('\nTriggering Back transition in browser...');
    await send('Runtime.evaluate', {
      expression: `window.app.triggerBack();`
    });

    await new Promise(r => setTimeout(r, 1400));

    const backEval = await send('Runtime.evaluate', {
      expression: `({
        viewState: window.app.viewState,
        defViewOpacity: document.querySelector('#definitions-view')?.style?.opacity,
        domOverlayOpacity: document.querySelector('#dom-panel-overlay')?.style?.opacity
      })`,
      returnByValue: true
    });
    console.log('--- POST-BACK DIAGNOSTICS ---');
    console.log(JSON.stringify(backEval.result?.value, null, 2));

    const shotBack = await send('Page.captureScreenshot', { format: 'png' });
    if (shotBack && shotBack.data) {
      const buf = Buffer.from(shotBack.data, 'base64');
      fs.writeFileSync(path.join(__dirname, 'cdp-back-screenshot.png'), buf);
      console.log(`Saved screenshot: cdp-back-screenshot.png (${buf.length} bytes)`);
    }

    // Clean exit
    console.log('\nAll checks completed successfully!');
    edge.kill();
    process.exit(0);
  };
});
