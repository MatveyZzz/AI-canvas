import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/index.js';
import { api } from './routes/api.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api', api);

// Central error handler — never leak stack/keys.
app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[server]', err.message);
  res.status(status).json({ error: { code: err.code ?? 'internal', message: status >= 500 ? 'Внутренняя ошибка сервера' : err.message } });
});

const PORT = Number(process.env.PORT ?? 8787);

initDb();
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`AI Canvas server on http://localhost:${PORT}`));
}

export { app };
