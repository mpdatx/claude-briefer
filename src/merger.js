export class Merger {
  constructor(files) {
    // files: { [relativePath]: content string }
    this.files = { ...files };
  }

  keepOne({ content, keepFile, removeFiles }) {
    const preview = {};
    for (const filePath of removeFiles) {
      const original = this.files[filePath];
      if (!original) continue;
      let modified = this._removeContent(original, content);
      modified = this._cleanEmptySections(modified);
      preview[filePath] = { before: original, after: modified };
    }
    return preview;
  }

  consolidate({ content, sectionName, sourceFiles, targetFile }) {
    const preview = {};
    const slug = sectionName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    const reference = `> See [${sectionName}](${targetFile}#${slug})`;

    const existingTarget = this.files[targetFile];
    let targetContent;
    if (existingTarget) {
      targetContent = existingTarget.trimEnd() + '\n\n## ' + sectionName + '\n\n' + content + '\n';
      preview[targetFile] = { before: existingTarget, after: targetContent, isNew: false };
    } else {
      targetContent = '# Shared\n\n## ' + sectionName + '\n\n' + content + '\n';
      preview[targetFile] = { before: '', after: targetContent, isNew: true };
    }

    for (const filePath of sourceFiles) {
      const original = this.files[filePath];
      if (!original) continue;
      const modified = original.replace(content, reference);
      preview[filePath] = { before: original, after: modified };
    }
    return preview;
  }

  deleteContent({ content, files }) {
    const preview = {};
    for (const filePath of files) {
      const original = this.files[filePath];
      if (!original) continue;
      let modified = this._removeContent(original, content);
      modified = this._cleanEmptySections(modified);
      preview[filePath] = { before: original, after: modified };
    }
    return preview;
  }

  _removeContent(text, content) {
    const result = text.replace(content, '');
    return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  _cleanEmptySections(text) {
    const lines = text.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
      const headingMatch = lines[i].match(/^(#{1,6})\s+/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        let hasContent = false;
        let j = i + 1;
        while (j < lines.length) {
          const nextHeading = lines[j].match(/^(#{1,6})\s+/);
          if (nextHeading && nextHeading[1].length <= level) break;
          if (lines[j].trim() !== '') {
            hasContent = true;
            break;
          }
          j++;
        }
        if (!hasContent) {
          i++;
          while (i < lines.length && lines[i].trim() === '') i++;
          continue;
        }
      }
      result.push(lines[i]);
      i++;
    }
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
}
