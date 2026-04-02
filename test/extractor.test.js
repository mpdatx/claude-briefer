import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractSegments } from '../src/extractor.js';

describe('extractSegments', () => {
  it('extracts plain prose text', () => {
    const segments = extractSegments('# Hello\n\nThis is a paragraph.');
    const prose = segments.filter(s => s.tag === 'prose');
    assert.ok(prose.some(s => s.text === 'Hello'));
    assert.ok(prose.some(s => s.text === 'This is a paragraph.'));
  });

  it('strips inline markdown formatting', () => {
    const segments = extractSegments('This is **bold** and *italic* text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('bold'));
    assert.ok(joined.includes('italic'));
    assert.ok(!joined.includes('**'));
    assert.ok(!joined.includes('*'));
  });

  it('extracts link text, discards URL', () => {
    const segments = extractSegments('Click [here for docs](https://example.com).');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('here for docs'));
    assert.ok(!joined.includes('https://'));
  });

  it('extracts image alt text', () => {
    const segments = extractSegments('![Alt text for image](image.png)');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('Alt text for image'));
    assert.ok(!joined.includes('image.png'));
  });

  it('extracts fenced code blocks as code-tagged segments', () => {
    const md = '# Title\n\n```js\nconst x = 1;\n```\n\nAfter.';
    const segments = extractSegments(md);
    const code = segments.filter(s => s.tag === 'code');
    assert.equal(code.length, 1);
    assert.ok(code[0].text.includes('const x = 1;'));
  });

  it('extracts inline code as code-tagged', () => {
    const segments = extractSegments('Use `npm install` to install.');
    const code = segments.filter(s => s.tag === 'code');
    assert.ok(code.some(s => s.text === 'npm install'));
  });

  it('does not concatenate text across structural boundaries', () => {
    const md = '- Item one\n- Item two\n\nParagraph here.';
    const segments = extractSegments(md);
    const prose = segments.filter(s => s.tag === 'prose');
    const texts = prose.map(s => s.text);
    assert.ok(!texts.some(s => s.includes('Item one') && s.includes('Item two')));
    assert.ok(!texts.some(s => s.includes('Item two') && s.includes('Paragraph')));
  });

  it('preserves line numbers for each segment', () => {
    const md = '# Title\n\nParagraph on line 3.\n\n```js\ncode\n```';
    const segments = extractSegments(md);
    for (const seg of segments) {
      assert.ok(typeof seg.line === 'number', `segment "${seg.text}" missing line number`);
      assert.ok(seg.line >= 1);
    }
  });

  it('extracts blockquote inner text as prose', () => {
    const segments = extractSegments('> This is quoted **bold** text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('This is quoted'));
    assert.ok(joined.includes('bold'));
  });

  it('handles strikethrough', () => {
    const segments = extractSegments('This is ~~deleted~~ text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('deleted'));
    assert.ok(!joined.includes('~~'));
  });
});
