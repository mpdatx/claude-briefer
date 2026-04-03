let cm = null;
let highlights = [];
let onNgramClick = null;
let suppressChange = false;

export function initEditor(container, { onContentChange, onNgramClicked, onSelectionChange }) {
  onNgramClick = onNgramClicked; // receives (stemmedNgram, allKeys)
  cm = CodeMirror(container, {
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    theme: 'default',
  });

  cm.on('change', () => {
    if (!suppressChange && onContentChange) onContentChange(cm.getValue());
  });

  cm.on('cursorActivity', () => {
    if (onSelectionChange) {
      const sel = cm.getSelection();
      onSelectionChange(sel);
    }
  });

  return cm;
}

export function getSelection() {
  return cm.getSelection();
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
          const allKeys = (span.stemmedKeys || [span.stemmed]).join(',');
          const mark = cm.markText(from, to, {
            className: cssClass,
            attributes: { 'data-ngram': span.stemmed || '', 'data-ngram-keys': allKeys },
          });
          highlights.push(mark);
          found = true;
        }
      } else {
        const from = { line: lineIdx, ch: charIdx };
        const to = { line: lineIdx, ch: charIdx + searchText.length };
        const cssClass = getHighlightClass(span.count, opts.maxCount);
        const allKeys = (span.stemmedKeys || [span.stemmed]).join(',');
        const mark = cm.markText(from, to, {
          className: cssClass,
          attributes: { 'data-ngram': span.stemmed || '', 'data-ngram-keys': allKeys },
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
      const allKeys = target.getAttribute('data-ngram-keys');
      if (ngram && onNgramClick) onNgramClick(ngram, allKeys);
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

// --- Comparison editor ---

let compareCm = null;
let compareHighlights = [];

export function showCompare(content, filePath, matchText) {
  const panel = document.getElementById('compare-panel');
  const container = document.getElementById('compare-editor');
  document.getElementById('compare-file').textContent = filePath;
  panel.style.display = '';

  if (!compareCm) {
    compareCm = CodeMirror(container, {
      mode: 'markdown',
      lineNumbers: true,
      lineWrapping: true,
      readOnly: true,
      theme: 'default',
    });
  }

  compareCm.setValue(content);

  // Clear old highlights
  for (const m of compareHighlights) m.clear();
  compareHighlights = [];

  // Highlight the match text and scroll to it
  if (matchText) {
    const lines = content.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const charIdx = lines[lineIdx].indexOf(matchText);
      if (charIdx !== -1) {
        const from = { line: lineIdx, ch: charIdx };
        const to = { line: lineIdx, ch: charIdx + matchText.length };
        const mark = compareCm.markText(from, to, { className: 'compare-highlight' });
        compareHighlights.push(mark);
        compareCm.scrollIntoView(from, 100);
        break;
      }
      // Try multiline
      const joined = lines.slice(lineIdx, lineIdx + 10).join('\n');
      const multiIdx = joined.indexOf(matchText);
      if (multiIdx !== -1) {
        const from = posFromOffset(lines, lineIdx, multiIdx);
        const to = posFromOffset(lines, lineIdx, multiIdx + matchText.length);
        const mark = compareCm.markText(from, to, { className: 'compare-highlight' });
        compareHighlights.push(mark);
        compareCm.scrollIntoView(from, 100);
        break;
      }
    }
  }

  // Also scroll the main editor to the match
  if (matchText) {
    const mainLines = cm.getValue().split('\n');
    for (let i = 0; i < mainLines.length; i++) {
      const idx = mainLines[i].indexOf(matchText);
      if (idx !== -1) {
        cm.scrollIntoView({ line: i, ch: idx }, 100);
        break;
      }
    }
  }
}

export function hideCompare() {
  document.getElementById('compare-panel').style.display = 'none';
  for (const m of compareHighlights) m.clear();
  compareHighlights = [];
}
