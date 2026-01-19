import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { SummarizeRequestSchema, SummarizeResponseSchema } from './validation';
import { summarize } from './ai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.GROQ_API_KEY), model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant' });
});

app.post('/api/summarize', async (req, res) => {
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
