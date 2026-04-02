import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'simple');

describe('API', () => {
  let app;

  before(async () => {
    app = await createApp({
      dir: FIXTURES,
      glob: '**/*.md',
      port: 0,
      ngramMin: 3,
      ngramMax: 8,
    });
  });

  describe('GET /api/files', () => {
    it('returns list of files with metadata', async () => {
      const res = await request(app).get('/api/files');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 3);
      const file = res.body.find(f => f.path === 'intro.md');
      assert.ok(file);
      assert.ok(typeof file.size === 'number');
      assert.ok(typeof file.redundancyScore === 'number');
    });
  });

  describe('GET /api/files/:path', () => {
    it('returns file content', async () => {
      const res = await request(app).get('/api/files/intro.md');
      assert.equal(res.status, 200);
      assert.ok(res.body.content.includes('# Introduction'));
    });

    it('returns 404 for unknown file', async () => {
      const res = await request(app).get('/api/files/nope.md');
      assert.equal(res.status, 404);
    });
  });

  describe('GET /api/ngrams/:path', () => {
    it('returns shared n-grams for a file', async () => {
      const res = await request(app).get('/api/ngrams/intro.md');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.ngrams));
      assert.ok(Array.isArray(res.body.spans));
    });
  });

  describe('GET /api/ngrams/:path with ngram query', () => {
    it('returns locations for a specific n-gram', async () => {
      const ngramRes = await request(app).get('/api/ngrams/intro.md');
      if (ngramRes.body.ngrams.length > 0) {
        const stemmed = ngramRes.body.ngrams[0].stemmed;
        const res = await request(app)
          .get('/api/ngrams/intro.md')
          .query({ ngram: stemmed });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.locations));
        assert.ok(res.body.locations.length >= 2);
      }
    });
  });

  describe('GET /api/redundancy', () => {
    it('returns redundancy report sorted by score', async () => {
      const res = await request(app).get('/api/redundancy');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      for (let i = 1; i < res.body.length; i++) {
        assert.ok(res.body[i].score <= res.body[i - 1].score);
      }
    });
  });

  describe('POST /api/merge/delete', () => {
    it('returns diff preview without applying', async () => {
      const ngramRes = await request(app).get('/api/ngrams/intro.md');
      if (ngramRes.body.ngrams.length > 0) {
        const original = ngramRes.body.ngrams[0].original;
        const res = await request(app)
          .post('/api/merge/delete')
          .send({
            content: original,
            files: ['intro.md'],
            apply: false,
          });
        assert.equal(res.status, 200);
        assert.ok(res.body.preview);
        assert.ok('intro.md' in res.body.preview);
        assert.ok(res.body.preview['intro.md'].before);
        assert.ok(res.body.preview['intro.md'].after);
      }
    });
  });
});
