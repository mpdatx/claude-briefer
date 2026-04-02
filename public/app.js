import { initEditor, setContent, getContent, getSelection, applyHighlights, showCompare, hideCompare } from './editor.js';
import { renderFileList, renderRedundancyOverview, renderNgramOccurrences, renderSelectionActions, renderSections, renderSectionActions, showDiffModal } from './panels.js';

let state = {
  files: [],
  activeFile: null,
  fileFilter: '',
  tagFilter: 'both',
  minOccurrences: 2,
  ngrams: [],
  spans: [],
  dirty: false,
  pairwiseScores: null, // {file: score} when a file is selected
};

const editor = initEditor(document.getElementById('editor'), {
  onContentChange: () => {
    state.dirty = true;
    document.getElementById('save-btn').disabled = false;
  },
  onNgramClicked: (stemmedNgram) => {
    loadNgramOccurrences(stemmedNgram);
  },
  onSelectionChange: (sel) => {
    document.getElementById('merge-selection-btn').disabled = !sel;
  },
});

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

async function loadFiles() {
  state.files = await api('/files');
  state.pairwiseScores = null;
  document.getElementById('dir-info').textContent =
    `${state.files.length} file(s)`;
  reRenderFileList();
}

function reRenderFileList() {
  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
    pairwiseScores: state.pairwiseScores,
  });
}

async function selectFile(filePath) {
  // Click active file again to deselect → return to global view
  if (filePath === state.activeFile && !state.dirty) {
    state.activeFile = null;
    state.pairwiseScores = null;
    document.getElementById('current-file').textContent = '';
    document.getElementById('save-btn').disabled = true;
    hideCompare();
    reRenderFileList();
    document.getElementById('context-content').innerHTML =
      '<p class="placeholder">Select a file to view redundancy info.</p>';
    return;
  }

  if (state.dirty && state.activeFile) {
    if (!confirm('You have unsaved changes. Discard?')) return;
  }

  state.activeFile = filePath;
  state.dirty = false;
  document.getElementById('save-btn').disabled = true;
  document.getElementById('current-file').textContent = filePath;
  hideCompare();

  // Fetch pairwise scores for the selected file
  const pairwise = await api(`/redundancy?file=${encodeURIComponent(filePath)}`);
  state.pairwiseScores = {};
  for (const entry of pairwise) {
    state.pairwiseScores[entry.file] = entry;
  }

  reRenderFileList();

  const fileData = await api(`/files/${filePath}`);
  setContent(fileData.content);

  await loadNgrams(filePath);
}

async function loadNgrams(filePath) {
  const data = await api(`/ngrams/${filePath}`);
  state.ngrams = data.ngrams;
  state.spans = data.spans;

  const filteredSpans = filterSpans(state.spans);
  const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
  applyHighlights(filteredSpans, { maxCount });

  renderRedundancyOverview(state.ngrams, filePath);

  // Append sections to the context panel
  const content = getContent();
  const sectionsHtml = renderSections(content, filePath, { onMergeSection: handleMergeSection });
  if (sectionsHtml) {
    document.getElementById('context-content').innerHTML += sectionsHtml;
    // Attach section merge handlers
    document.querySelectorAll('[data-action="merge-section"]').forEach(btn => {
      btn.onclick = () => handleMergeSection(parseInt(btn.dataset.line, 10));
    });
  }
}

async function loadNgramOccurrences(stemmedNgram) {
  const data = await api(`/ngrams/${state.activeFile}?ngram=${encodeURIComponent(stemmedNgram)}`);
  const otherLocs = data.locations.filter(l => l.file !== state.activeFile);

  // Auto-open comparison if there's exactly one other file
  if (otherLocs.length === 1) {
    openComparison(otherLocs[0].file, otherLocs[0].original);
  } else if (otherLocs.length > 1) {
    // Show first match, user can switch via right panel
    openComparison(otherLocs[0].file, otherLocs[0].original);
  } else {
    hideCompare();
  }

  renderNgramOccurrences(stemmedNgram, data.locations, state.activeFile, {
    onKeepOne: handleKeepOne,
    onDelete: handleDelete,
    onConsolidate: handleConsolidate,
    onCompare: (file, original) => openComparison(file, original),
  });
}

async function openComparison(filePath, matchText) {
  const fileData = await api(`/files/${filePath}`);
  showCompare(fileData.content, filePath, matchText);
}

function filterSpans(spans) {
  return spans.filter(span => {
    if (state.tagFilter !== 'both' && span.tag !== state.tagFilter) return false;
    if (span.count && span.count < state.minOccurrences) return false;
    return true;
  });
}

async function handleKeepOne(keepFile, locations) {
  const otherFiles = locations
    .map(l => l.file)
    .filter(f => f !== keepFile);
  const original = locations[0].original;

  const data = await api('/merge/keep-one', {
    method: 'POST',
    body: { content: original, keepFile, removeFiles: otherFiles, apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/keep-one', {
        method: 'POST',
        body: { content: original, keepFile, removeFiles: otherFiles, apply: true },
      });
      await refresh();
    },
  });
}

async function handleDelete(file) {
  const ngrams = state.ngrams;
  const original = ngrams.length > 0 ? ngrams[0].original : '';

  const data = await api('/merge/delete', {
    method: 'POST',
    body: { content: original, files: [file], apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/delete', {
        method: 'POST',
        body: { content: original, files: [file], apply: true },
      });
      await refresh();
    },
  });
}

async function handleConsolidate(file, locations) {
  const targetFile = prompt('Consolidate to which file?', 'shared.md');
  if (!targetFile) return;

  const sectionName = prompt('Section name?', 'Shared');
  if (!sectionName) return;

  const original = locations[0].original;
  const sourceFiles = locations.map(l => l.file);

  const data = await api('/merge/consolidate', {
    method: 'POST',
    body: { content: original, sectionName, sourceFiles, targetFile, apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/consolidate', {
        method: 'POST',
        body: { content: original, sectionName, sourceFiles, targetFile, apply: true },
      });
      await refresh();
    },
  });
}

// --- Selection merge ---

function handleSelectionMerge() {
  const sel = getSelection();
  if (!sel || !state.activeFile) return;
  const allFiles = state.files.map(f => f.path);
  renderSelectionActions(sel, state.activeFile, allFiles, {
    onKeepOne: handleContentKeepOne,
    onDelete: handleContentDelete,
    onConsolidate: handleContentConsolidate,
  });
}

// --- Section merge ---

function handleMergeSection(lineIndex) {
  const content = getContent();
  const lines = content.split('\n');
  const headingMatch = lines[lineIndex].match(/^(#{1,6})\s+(.+)/);
  if (!headingMatch) return;

  const level = headingMatch[1].length;
  const title = headingMatch[2];

  // Extract section content: from heading to next heading of equal/higher level
  let endLine = lines.length;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const nextMatch = lines[i].match(/^(#{1,6})\s+/);
    if (nextMatch && nextMatch[1].length <= level) {
      endLine = i;
      break;
    }
  }

  const sectionContent = lines.slice(lineIndex, endLine).join('\n').trim();
  const allFiles = state.files.map(f => f.path);

  renderSectionActions(title, sectionContent, state.activeFile, allFiles, {
    onKeepOne: handleContentKeepOne,
    onDelete: handleContentDelete,
    onConsolidate: handleContentConsolidate,
  });
}

// --- Generic content merge handlers (shared by selection + section) ---

async function handleContentKeepOne(keepFile, content, removeFiles) {
  const data = await api('/merge/keep-one', {
    method: 'POST',
    body: { content, keepFile, removeFiles, apply: false },
  });
  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/keep-one', {
        method: 'POST',
        body: { content, keepFile, removeFiles, apply: true },
      });
      await refresh();
    },
  });
}

async function handleContentDelete(file, content) {
  const data = await api('/merge/delete', {
    method: 'POST',
    body: { content, files: [file], apply: false },
  });
  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/delete', {
        method: 'POST',
        body: { content, files: [file], apply: true },
      });
      await refresh();
    },
  });
}

async function handleContentConsolidate(file, content, allFiles) {
  const targetFile = prompt('Consolidate to which file?', 'shared.md');
  if (!targetFile) return;
  const sectionName = prompt('Section name?', 'Shared');
  if (!sectionName) return;

  const data = await api('/merge/consolidate', {
    method: 'POST',
    body: { content, sectionName, sourceFiles: [file], targetFile, apply: false },
  });
  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/consolidate', {
        method: 'POST',
        body: { content, sectionName, sourceFiles: [file], targetFile, apply: true },
      });
      await refresh();
    },
  });
}

async function save() {
  if (!state.activeFile) return;
  await api(`/files/${state.activeFile}`, {
    method: 'PUT',
    body: { content: getContent() },
  });
  state.dirty = false;
  document.getElementById('save-btn').disabled = true;
  await loadFiles();
  await loadNgrams(state.activeFile);
}

async function refresh() {
  await loadFiles();
  if (state.activeFile) {
    const fileData = await api(`/files/${state.activeFile}`);
    setContent(fileData.content);
    state.dirty = false;
    document.getElementById('save-btn').disabled = true;
    await loadNgrams(state.activeFile);
  }
}

document.getElementById('save-btn').onclick = save;
document.getElementById('merge-selection-btn').onclick = handleSelectionMerge;
document.getElementById('close-compare-btn').onclick = hideCompare;

document.getElementById('file-search').oninput = (e) => {
  state.fileFilter = e.target.value;
  reRenderFileList();
};

document.getElementById('tag-filter').onchange = (e) => {
  state.tagFilter = e.target.value;
  if (state.activeFile) {
    const filteredSpans = filterSpans(state.spans);
    const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
    applyHighlights(filteredSpans, { maxCount });
  }
};

document.getElementById('min-occurrences').oninput = (e) => {
  state.minOccurrences = parseInt(e.target.value, 10);
  document.getElementById('min-occ-value').textContent = state.minOccurrences;
  if (state.activeFile) {
    const filteredSpans = filterSpans(state.spans);
    const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
    applyHighlights(filteredSpans, { maxCount });
  }
};

loadFiles();
