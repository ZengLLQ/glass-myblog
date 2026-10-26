import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import('./server.js').then(async () => {
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--enable-webgl',
    '--window-size=1440,960',
    'http://localhost:3000'
  ]);

  let endpoint = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch('http://127.0.0.1:9225/json');
      const list = await res.json();
      if (list && list.length > 0) { endpoint = list[0]; break; }
    } catch(e){}
  }

  const ws = new WebSocket(endpoint.webSocketDebuggerUrl);
  let id = 1;
  const cbs = new Map();
  function send(m, p={}) {
    return new Promise(res => { const mid = id++; cbs.set(mid, res); ws.send(JSON.stringify({id: mid, method: m, params: p})); });
  }
  ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && cbs.has(d.id)) { cbs.get(d.id)(d.result); cbs.delete(d.id); } };
  ws.onopen = async () => {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 2500));

    const boxes = await send('Runtime.evaluate', {
      expression: `(() => {
        const overlay = document.querySelector('#dom-panel-overlay');
        const headline = document.querySelector('.dom-headline');
        const cta = document.querySelector('.dom-cta-row');
        const canvas = document.querySelector('canvas');
        return {
          window: { w: window.innerWidth, h: window.innerHeight },
          overlayStyle: {
            transform: overlay ? overlay.style.transform : null,
            width: overlay ? overlay.style.width : null,
            height: overlay ? overlay.style.height : null,
            opacity: overlay ? overlay.style.opacity : null
          },
          overlayRect: overlay ? overlay.getBoundingClientRect() : null,
          headlineRect: headline ? headline.getBoundingClientRect() : null,
          ctaRect: cta ? cta.getBoundingClientRect() : null,
          canvasRect: canvas ? canvas.getBoundingClientRect() : null,
          appSizes: window.app ? window.app.sizes : null
        };
      })()`,
      returnByValue: true
    });
    console.log(JSON.stringify(boxes.result.value, null, 2));
    edge.kill();
    process.exit(0);
  };
});
