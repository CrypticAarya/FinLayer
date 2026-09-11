const http = require('http');
const fs = require('fs');
const path = require('path');

const dir = path.resolve('apps/windows-app/release');
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let fileName = urlPath.replace(/^\//, '');
  if (!fileName || fileName.startsWith('latest')) {
    fileName = 'latest.yml';
  }
  const filePath = path.join(dir, fileName);
  console.log('[Server] Request:', req.url, '-> resolving to:', filePath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fs.statSync(filePath).size,
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    console.log('[Server] 404 for:', filePath);
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(4005, '127.0.0.1', () => {
  console.log('Update test server listening on http://127.0.0.1:4005');
});
