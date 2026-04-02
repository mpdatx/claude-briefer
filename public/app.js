import { initEditor, setContent, getContent, applyHighlights } from './editor.js';
import { renderFileList, renderRedundancyOverview, renderNgramOccurrences, showDiffModal } from './panels.js';

let state = {
  files: [],
  activeFile: null,
  fileFilter: '',
  tagFilter: 'both',
  minOccurrences: 2,
  ngrams: [],
  spans: [],
  dirty: false,
};

const editor = initEditor(document.getElementById('editor'), {
  onContentChange: () => {
    state.dirty = true;
    document.getElementById('save-btn').disabled = false;
  },
  onNgramClicked: (stemmedNgram) => {
    loadNgramOccurrences(stemmedNgram);
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
  document.getElementById('dir-info').textContent =
    `${state.files.length} file(s)`;
  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });
}

async function selectFile(filePath) {
  if (state.dirty && state.activeFile) {
    if (!confirm('You have unsaved changes. Discard?')) return;
  }

  state.activeFile = filePath;
  state.dirty = false;
  document.getElementById('save-btn').disabled = true;
  document.getElementById('current-file').textContent = filePath;

  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });

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
}

async function loadNgramOccurrences(stemmedNgram) {
  const data = await api(`/ngrams/${state.activeFile}?ngram=${encodeURIComponent(stemmedNgram)}`);
  renderNgramOccurrences(stemmedNgram, data.locations, state.activeFile, {
    onKeepOne: handleKeepOne,
    onDelete: handleDelete,
    onConsolidate: handleConsolidate,
  });
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

document.getElementById('file-search').oninput = (e) => {
  state.fileFilter = e.target.value;
  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });
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
