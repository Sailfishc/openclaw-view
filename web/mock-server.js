import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load events from JSONL file
async function loadEvents() {
  const filePath = join(__dirname, 'mock-data/trace-viewer_20260308_143400.jsonl');
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  return lines.map(line => JSON.parse(line));
}

let events = [];
loadEvents().then(data => {
  events = data;
  console.log(`Loaded ${events.length} events from mock data`);
});

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.url === '/trace/api/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events, stats: { totalEvents: events.length } }));
  } else if (req.url === '/trace/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ totalEvents: events.length }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3001, () => {
  console.log('Mock server running at http://localhost:3001');
  console.log('Test: http://localhost:3001/trace/api/events');
});
