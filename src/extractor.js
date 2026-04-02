import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true }).enable('strikethrough');

export function extractSegments(markdown) {
  const stripped = stripFrontmatter(markdown);
  const tokens = md.parse(stripped, {});
  const segments = [];
  collectSegments(tokens, segments);
  return segments;
}

function stripFrontmatter(text) {
  // YAML frontmatter: starts with --- on first line, ends with ---
  const yamlMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (yamlMatch) return text.slice(yamlMatch[0].length);

  // TOML frontmatter: starts with +++ on first line, ends with +++
  const tomlMatch = text.match(/^\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+\r?\n?/);
  if (tomlMatch) return text.slice(tomlMatch[0].length);

  return text;
}

function collectSegments(tokens, segments) {
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') {
      const line = token.map ? token.map[0] + 1 : 1;
      segments.push({ text: token.content.trimEnd(), tag: 'code', line });
    } else if (token.type === 'inline') {
      const line = token.map ? token.map[0] + 1 : 1;
      extractInlineSegments(token.children, line, segments);
    } else if (token.children && token.children.length > 0) {
      collectSegments(token.children, segments);
    }
  }
}

const SKIP_TYPES = new Set([
  'strong_open', 'strong_close',
  'em_open', 'em_close',
  's_open', 's_close',
  'link_open', 'link_close',
  'softbreak', 'hardbreak',
]);

function extractInlineSegments(children, line, segments) {
  let accumulated = '';

  function flushProse() {
    const trimmed = accumulated.trim();
    if (trimmed) {
      segments.push({ text: trimmed, tag: 'prose', line });
    }
    accumulated = '';
  }

  for (const child of children) {
    if (child.type === 'text') {
      accumulated += child.content;
    } else if (child.type === 'code_inline') {
      flushProse();
      segments.push({ text: child.content, tag: 'code', line });
    } else if (child.type === 'image') {
      flushProse();
      // Extract alt text from image children
      const altParts = [];
      for (const imgChild of child.children || []) {
        if (imgChild.type === 'text') {
          altParts.push(imgChild.content);
        }
      }
      const altText = altParts.join('').trim();
      if (altText) {
        segments.push({ text: altText, tag: 'prose', line });
      }
    } else if (SKIP_TYPES.has(child.type)) {
      // skip formatting tokens
    } else if (child.type === 'html_inline') {
      // skip html
    }
  }

  flushProse();
}
