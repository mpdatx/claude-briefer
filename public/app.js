import { initEditor, setContent, getContent, getSelection, applyHighlights, showCompare, hideCompare } from './editor.js';
import { renderFileList, renderRedundancyOverview, renderNgramOccurrences, renderSelectionActions, renderSections, renderSectionActions, showDiffModal, renderNgramList } from './panels.js';

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
  onNgramClicked: (stemmedNgram, allKeys) => {
    loadNgramOccurrences(stemmedNgram, allKeys);
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

async function loadNgramOccurrences(stemmedNgram, allKeys) {
  if (!stemmedNgram || !state.activeFile) return;

  // Try the primary (longest) key first; if no cross-file results, try others
  let locations = [];
  const keysToTry = allKeys ? allKeys.split(',') : [stemmedNgram];
  // Sort by length descending — try longest first
  keysToTry.sort((a, b) => b.length - a.length);

  for (const key of keysToTry) {
    const data = await api(`/ngrams/${state.activeFile}?ngram=${encodeURIComponent(key)}`);
    const locs = data.locations || [];
    if (locs.some(l => l.file !== state.activeFile)) {
      locations = locs;
      break;
    }
    if (locs.length > locations.length) locations = locs;
  }

  const otherLocs = locations.filter(l => l.file !== state.activeFile);

  // Auto-open comparison if there's exactly one other file
  if (otherLocs.length === 1) {
    openComparison(otherLocs[0].file, otherLocs[0].original);
  } else if (otherLocs.length > 1) {
    // Show first match, user can switch via right panel
    openComparison(otherLocs[0].file, otherLocs[0].original);
  } else {
    hideCompare();
  }

  renderNgramOccurrences(stemmedNgram, locations, state.activeFile, {
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
  // Refresh n-gram browser if visible
  if (leftTab === 'ngrams') loadAllNgrams();
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

// --- Left panel tabs ---

let leftTab = 'files';
let allSharedNgrams = [];
let ngramFilter = '';
let ngramSort = 'count-desc';
let activeNgramKey = null;

document.querySelectorAll('.left-tab').forEach(btn => {
  btn.onclick = () => {
    leftTab = btn.dataset.tab;
    document.querySelectorAll('.left-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('files-tab').style.display = leftTab === 'files' ? '' : 'none';
    document.getElementById('ngrams-tab').style.display = leftTab === 'ngrams' ? '' : 'none';
    if (leftTab === 'ngrams' && allSharedNgrams.length === 0) {
      loadAllNgrams();
    }
  };
});

async function loadAllNgrams() {
  allSharedNgrams = await api('/ngrams');
  reRenderNgramList();
}

function reRenderNgramList() {
  renderNgramList(allSharedNgrams, {
    onSelect: handleNgramBrowserSelect,
    activeNgram: activeNgramKey,
    filter: ngramFilter,
    sort: ngramSort,
  });
}

async function handleNgramBrowserSelect(ng) {
  activeNgramKey = ng.stemmed;
  reRenderNgramList();

  // Load locations and show in right panel
  const data = await api(`/ngrams/${encodeURIComponent(ng.files[0])}?ngram=${encodeURIComponent(ng.stemmed)}`);
  const locations = data.locations || [];

  // If a file is selected, open comparison; otherwise select first file
  if (!state.activeFile && ng.files.length > 0) {
    await selectFile(ng.files[0]);
  }

  const otherLocs = locations.filter(l => l.file !== state.activeFile);
  if (otherLocs.length > 0) {
    openComparison(otherLocs[0].file, otherLocs[0].original);
  }

  renderNgramOccurrences(ng.stemmed, locations, state.activeFile, {
    onKeepOne: handleKeepOne,
    onDelete: handleDelete,
    onConsolidate: handleConsolidate,
    onCompare: (file, original) => openComparison(file, original),
  });
}

document.getElementById('ngram-search').oninput = (e) => {
  ngramFilter = e.target.value;
  reRenderNgramList();
};

document.getElementById('ngram-sort').onchange = (e) => {
  ngramSort = e.target.value;
  reRenderNgramList();
};

// --- Sources editor ---

let editInclude = [];
let editExclude = [];

function renderPatternList(container, patterns, onChange) {
  container.innerHTML = '';
  for (let i = 0; i < patterns.length; i++) {
    const row = document.createElement('div');
    row.className = 'pattern-row';
    row.innerHTML = `
      <input type="text" value="${patterns[i]}" placeholder="**/*.md">
      <button title="Remove">&times;</button>
    `;
    row.querySelector('input').oninput = (e) => {
      patterns[i] = e.target.value;
    };
    row.querySelector('button').onclick = () => {
      patterns.splice(i, 1);
      onChange();
    };
    container.appendChild(row);
  }
}

function renderSourcesEditor() {
  renderPatternList(
    document.getElementById('include-list'), editInclude, renderSourcesEditor
  );
  renderPatternList(
    document.getElementById('exclude-list'), editExclude, renderSourcesEditor
  );
}

document.getElementById('edit-sources-btn').onclick = async () => {
  const config = await api('/config');
  editInclude = [...(config.include || ['**/*.md'])];
  editExclude = [...(config.exclude || [])];
  document.getElementById('sources-dir').textContent = `Root: ${config.dir}`;
  renderSourcesEditor();
  document.getElementById('sources-editor').style.display = '';
};

document.getElementById('cancel-sources-btn').onclick = () => {
  document.getElementById('sources-editor').style.display = 'none';
};

document.getElementById('add-include-btn').onclick = () => {
  editInclude.push('**/*.md');
  renderSourcesEditor();
};

document.getElementById('add-exclude-btn').onclick = () => {
  editExclude.push('');
  renderSourcesEditor();
};

document.getElementById('apply-sources-btn').onclick = async () => {
  const include = editInclude.filter(p => p.trim());
  const exclude = editExclude.filter(p => p.trim());
  if (include.length === 0) return;

  await api('/config', {
    method: 'POST',
    body: { include, exclude },
  });

  document.getElementById('sources-editor').style.display = 'none';
  state.activeFile = null;
  state.pairwiseScores = null;
  hideCompare();
  await loadFiles();
  if (leftTab === 'ngrams') loadAllNgrams();
  document.getElementById('context-content').innerHTML =
    '<p class="placeholder">Select a file to view redundancy info.</p>';
};

loadFiles();
