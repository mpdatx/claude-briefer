export function renderFileList(files, { onSelect, activeFile, filter }) {
  const ul = document.getElementById('files');
  ul.innerHTML = '';

  const maxScore = Math.max(...files.map(f => f.redundancyScore), 0.01);
  const filtered = filter
    ? files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()))
    : files;

  // Build tree structure
  const tree = {};
  for (const file of filtered) {
    const parts = file.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = file;
  }

  renderTreeNode(ul, tree, '', { onSelect, activeFile, maxScore, depth: 0 });
}

function renderTreeNode(container, node, prefix, opts) {
  const dirs = [];
  const files = [];

  for (const [name, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && !value.path) {
      dirs.push([name, value]);
    } else {
      files.push([name, value]);
    }
  }

  // Sort dirs and files alphabetically
  dirs.sort((a, b) => a[0].localeCompare(b[0]));
  files.sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, children] of dirs) {
    const dirEl = document.createElement('div');
    dirEl.className = 'tree-dir';
    dirEl.style.paddingLeft = `${8 + opts.depth * 16}px`;
    dirEl.innerHTML = `<span class="tree-dir-icon">&#9662;</span> ${escapeHtml(name)}`;
    dirEl.onclick = (e) => {
      e.stopPropagation();
      dirEl.classList.toggle('collapsed');
    };
    container.appendChild(dirEl);

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-dir-children';
    renderTreeNode(childContainer, children, prefix ? `${prefix}/${name}` : name, {
      ...opts,
      depth: opts.depth + 1,
    });
    container.appendChild(childContainer);
  }

  for (const [name, file] of files) {
    const fileEl = document.createElement('div');
    fileEl.className = 'tree-file';
    if (file.path === opts.activeFile) fileEl.classList.add('active');
    fileEl.style.paddingLeft = `${8 + opts.depth * 16}px`;
    fileEl.onclick = () => opts.onSelect(file.path);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';

    const bar = document.createElement('div');
    bar.className = 'redundancy-bar';
    const fill = document.createElement('div');
    fill.className = 'redundancy-bar-fill';
    fill.style.width = `${Math.min(100, (file.redundancyScore / opts.maxScore) * 100)}%`;
    bar.appendChild(fill);

    fileEl.appendChild(nameSpan);
    fileEl.appendChild(bar);
    container.appendChild(fileEl);
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

export function renderSelectionActions(selectedText, currentFile, allFiles, { onKeepOne, onDelete, onConsolidate }) {
  const container = document.getElementById('context-content');

  const truncated = selectedText.length > 80
    ? selectedText.slice(0, 80) + '...'
    : selectedText;

  let html = `<h3>Selection</h3>
    <p style="margin-bottom:8px;color:#888;font-size:12px">"${escapeHtml(truncated)}"</p>
    <p style="margin-bottom:12px;font-size:12px">${selectedText.length} characters selected</p>
    <div class="occurrence">
      <div class="occurrence-file">${currentFile} (current)</div>
      <div class="occurrence-actions">
        <button data-action="keep">Keep here, remove from others</button>
        <button data-action="delete">Delete this selection</button>
        <button data-action="consolidate">Consolidate to file...</button>
      </div>
    </div>`;

  container.innerHTML = html;

  container.querySelector('[data-action="keep"]').onclick = () => {
    const others = allFiles.filter(f => f !== currentFile);
    onKeepOne(currentFile, selectedText, others);
  };
  container.querySelector('[data-action="delete"]').onclick = () => {
    onDelete(currentFile, selectedText);
  };
  container.querySelector('[data-action="consolidate"]').onclick = () => {
    onConsolidate(currentFile, selectedText, allFiles);
  };
}

export function renderSections(content, currentFile, { onMergeSection }) {
  const lines = content.split('\n');
  const sections = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      sections.push({ level: match[1].length, title: match[2], line: i });
    }
  }

  if (sections.length === 0) return '';

  let html = '<h3 style="margin-top:16px">Sections</h3>';
  for (const sec of sections) {
    const indent = (sec.level - 1) * 12;
    html += `
      <div class="overlap-summary" style="margin-left:${indent}px;cursor:pointer" data-section-line="${sec.line}">
        <h4 style="font-size:12px">${'#'.repeat(sec.level)} ${escapeHtml(sec.title)}</h4>
        <div class="occurrence-actions">
          <button data-action="merge-section" data-line="${sec.line}">Merge section...</button>
        </div>
      </div>`;
  }

  return html;
}

export function renderSectionActions(sectionTitle, sectionContent, currentFile, allFiles, { onKeepOne, onDelete, onConsolidate }) {
  const container = document.getElementById('context-content');

  const truncated = sectionContent.length > 200
    ? sectionContent.slice(0, 200) + '...'
    : sectionContent;

  let html = `<h3>Section: ${escapeHtml(sectionTitle)}</h3>
    <div class="occurrence-context" style="margin-bottom:12px">${escapeHtml(truncated)}</div>
    <div class="occurrence">
      <div class="occurrence-actions">
        <button data-action="keep">Keep here, remove from others</button>
        <button data-action="delete">Delete this section</button>
        <button data-action="consolidate">Consolidate to file...</button>
      </div>
    </div>`;

  container.innerHTML = html;

  container.querySelector('[data-action="keep"]').onclick = () => {
    const others = allFiles.filter(f => f !== currentFile);
    onKeepOne(currentFile, sectionContent, others);
  };
  container.querySelector('[data-action="delete"]').onclick = () => {
    onDelete(currentFile, sectionContent);
  };
  container.querySelector('[data-action="consolidate"]').onclick = () => {
    onConsolidate(currentFile, sectionContent, allFiles);
  };
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
