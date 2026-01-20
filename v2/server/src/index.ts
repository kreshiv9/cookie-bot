import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { SummarizeRequestSchema, SummarizeResponseSchema } from './validation';
import { summarize } from './ai';

const app = express();
// CORS configuration: allow specific origins if provided
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (allowed.length > 0) {
  app.use(cors({ origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }}));
} else {
  app.use(cors());
}
app.use(express.json({ limit: '256kb' }));
// Basic rate limiting for summarize endpoint
const limiter = rateLimit({ windowMs: 60_000, max: process.env.RATE_LIMIT_PER_MIN ? Number(process.env.RATE_LIMIT_PER_MIN) : 60 });

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.GROQ_API_KEY), model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant' });
});

app.post('/api/summarize', limiter, async (req, res) => {
  const parse = SummarizeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid_request', details: parse.error.flatten() });
  }
  try {
    const result = await summarize(parse.data);
    const check = SummarizeResponseSchema.safeParse(result.response);
    if (!check.success) {
      return res.status(500).json({ error: 'invalid_response_shape', details: check.error.flatten() });
    }
    res.set('x-summarizer-source', result.source);
    if (result.model) res.set('x-summarizer-model', result.model);
    res.json(result.response);
  } catch (e: any) {
    res.status(500).json({ error: 'summarize_failed', message: e?.message || String(e) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Cookie Bot summarizer listening on :${port}`);
});
