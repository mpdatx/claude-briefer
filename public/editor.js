let cm = null;
let highlights = [];
let onNgramClick = null;
let suppressChange = false;

export function initEditor(container, { onContentChange, onNgramClicked }) {
  onNgramClick = onNgramClicked;
  cm = CodeMirror(container, {
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    theme: 'default',
  });

  cm.on('change', () => {
    if (!suppressChange && onContentChange) onContentChange(cm.getValue());
  });

  return cm;
}

export function setContent(text) {
  suppressChange = true;
  cm.setValue(text);
  suppressChange = false;
  clearHighlights();
}

export function getContent() {
  return cm.getValue();
}

export function clearHighlights() {
  for (const mark of highlights) {
    mark.clear();
  }
  highlights = [];
}

export function applyHighlights(spans, opts = {}) {
  clearHighlights();

  const text = cm.getValue();
  const lines = text.split('\n');

  for (const span of spans) {
    const searchStart = Math.max(0, (span.line || 1) - 2);
    const searchText = span.original;

    let found = false;
    for (let lineIdx = searchStart; lineIdx < lines.length && !found; lineIdx++) {
      const lineText = lines[lineIdx];
      let charIdx = lineText.indexOf(searchText);

      if (charIdx === -1) {
        const joinedFromHere = lines.slice(lineIdx, lineIdx + 5).join('\n');
        const multiIdx = joinedFromHere.indexOf(searchText);
        if (multiIdx !== -1) {
          const from = posFromOffset(lines, lineIdx, multiIdx);
          const to = posFromOffsetEnd(lines, lineIdx, multiIdx + searchText.length);
          const cssClass = getHighlightClass(span.count, opts.maxCount);
          const mark = cm.markText(from, to, {
            className: cssClass,
            attributes: { 'data-ngram': span.stemmed || '' },
          });
          highlights.push(mark);
          found = true;
        }
      } else {
        const from = { line: lineIdx, ch: charIdx };
        const to = { line: lineIdx, ch: charIdx + searchText.length };
        const cssClass = getHighlightClass(span.count, opts.maxCount);
        const mark = cm.markText(from, to, {
          className: cssClass,
          attributes: { 'data-ngram': span.stemmed || '' },
        });
        highlights.push(mark);
        found = true;
      }
    }
  }

  cm.getWrapperElement().onclick = (e) => {
    const target = e.target;
    if (target.classList.contains('ngram-highlight') ||
        target.classList.contains('ngram-highlight-strong') ||
        target.classList.contains('ngram-highlight-max')) {
      const ngram = target.getAttribute('data-ngram');
      if (ngram && onNgramClick) onNgramClick(ngram);
    }
  };
}

function getHighlightClass(count, maxCount) {
  if (!count || !maxCount || maxCount <= 2) return 'ngram-highlight';
  const ratio = count / maxCount;
  if (ratio > 0.7) return 'ngram-highlight-max';
  if (ratio > 0.4) return 'ngram-highlight-strong';
  return 'ngram-highlight';
}

function posFromOffset(lines, startLine, offset) {
  let remaining = offset;
  for (let i = startLine; i < lines.length; i++) {
    const lineLen = lines[i].length + 1;
    if (remaining <= lines[i].length) {
      return { line: i, ch: remaining };
    }
    remaining -= lineLen;
  }
  return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}

function posFromOffsetEnd(lines, startLine, offset) {
  return posFromOffset(lines, startLine, offset);
}
