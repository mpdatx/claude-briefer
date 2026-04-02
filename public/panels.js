export function renderFileList(files, { onSelect, activeFile, filter }) {
  const ul = document.getElementById('files');
  ul.innerHTML = '';

  const maxScore = Math.max(...files.map(f => f.redundancyScore), 0.01);
  const filtered = filter
    ? files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()))
    : files;

  for (const file of filtered) {
    const li = document.createElement('li');
    if (file.path === activeFile) li.classList.add('active');
    li.onclick = () => onSelect(file.path);

    const name = document.createElement('span');
    name.textContent = file.path;

    const bar = document.createElement('div');
    bar.className = 'redundancy-bar';
    const fill = document.createElement('div');
    fill.className = 'redundancy-bar-fill';
    fill.style.width = `${Math.min(100, (file.redundancyScore / maxScore) * 100)}%`;
    bar.appendChild(fill);

    li.appendChild(name);
    li.appendChild(bar);
    ul.appendChild(li);
  }
}

export function renderRedundancyOverview(ngrams, filePath) {
  const container = document.getElementById('context-content');

  if (!ngrams || ngrams.length === 0) {
    container.innerHTML = '<p class="placeholder">No redundant content detected in this file.</p>';
    return;
  }

  const fileOverlaps = new Map();
  for (const ng of ngrams) {
    for (const loc of ng.locations) {
      if (loc.file === filePath) continue;
      if (!fileOverlaps.has(loc.file)) {
        fileOverlaps.set(loc.file, { count: 0, ngrams: [] });
      }
      const entry = fileOverlaps.get(loc.file);
      entry.count++;
      if (entry.ngrams.length < 3) {
        entry.ngrams.push(ng.original);
      }
    }
  }

  let html = '<h3>Redundancy Overview</h3>';
  const sorted = [...fileOverlaps.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [file, data] of sorted) {
    html += `
      <div class="overlap-summary">
        <h4>${file}</h4>
        <p>${data.count} shared n-gram(s)</p>
        <p style="color:#888;font-size:12px">${data.ngrams.map(n => `"${n}"`).join(', ')}${data.count > 3 ? '...' : ''}</p>
      </div>`;
  }

  container.innerHTML = html;
}

export function renderNgramOccurrences(ngram, locations, currentFile, { onKeepOne, onDelete, onConsolidate }) {
  const container = document.getElementById('context-content');

  let html = `<h3>N-gram occurrences</h3><p style="margin-bottom:12px;color:#888;font-size:12px">"${ngram}"</p>`;

  for (const loc of locations) {
    const isCurrent = loc.file === currentFile;
    html += `
      <div class="occurrence">
        <div class="occurrence-file">${loc.file}${isCurrent ? ' (current)' : ''}</div>
        <div class="occurrence-context">${escapeHtml(loc.original || '')}</div>
        <div class="occurrence-actions">
          <button data-action="keep" data-file="${loc.file}">Keep here, remove others</button>
          <button data-action="delete" data-file="${loc.file}">Delete this one</button>
          <button data-action="consolidate" data-file="${loc.file}">Consolidate to file...</button>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      const file = btn.dataset.file;
      if (action === 'keep') onKeepOne(file, locations);
      else if (action === 'delete') onDelete(file);
      else if (action === 'consolidate') onConsolidate(file, locations);
    };
  });
}

export function showDiffModal(preview, { onConfirm, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let diffHtml = '';
  for (const [file, changes] of Object.entries(preview)) {
    diffHtml += `<h4>${file}${changes.isNew ? ' (new)' : ''}</h4>`;
    diffHtml += renderDiff(changes.before || '', changes.after);
  }

  overlay.innerHTML = `
    <div class="modal">
      <h3>Preview Changes</h3>
      <div class="diff-preview">${diffHtml}</div>
      <div class="modal-actions">
        <button class="btn-cancel">Cancel</button>
        <button class="btn-confirm">Apply</button>
      </div>
    </div>`;

  overlay.querySelector('.btn-cancel').onclick = () => {
    overlay.remove();
    if (onCancel) onCancel();
  };

  overlay.querySelector('.btn-confirm').onclick = () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  };

  document.body.appendChild(overlay);
}

function renderDiff(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let html = '';

  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  for (const line of beforeLines) {
    if (!afterSet.has(line)) {
      html += `<span class="diff-removed">- ${escapeHtml(line)}</span>\n`;
    }
  }
  for (const line of afterLines) {
    if (!beforeSet.has(line)) {
      html += `<span class="diff-added">+ ${escapeHtml(line)}</span>\n`;
    }
  }

  return html || '<span style="color:#666">(no changes)</span>\n';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
