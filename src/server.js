import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(opts) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dir: opts.dir });
  });

  return app;
}

export async function startServer(opts) {
  const app = createApp(opts);

  app.listen(opts.port, () => {
    const url = `http://localhost:${opts.port}`;
    console.log(`Claude Briefer running at ${url}`);
    console.log(`Scanning: ${opts.dir} (${opts.glob})`);
    open(url);
  });
}
