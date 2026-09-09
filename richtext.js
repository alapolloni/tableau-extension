'use strict';

(function () {
  // ---- CUSTOMIZE THESE ----------------------------------------------------
  // Words that should render italic wherever they appear (case-insensitive).
  const ITALIC_WORDS = ['delayed', 'pending', 'in progress'];

  // Words that should render large + bold (e.g. severity flags).
  const BIG_WORDS = ['critical', 'urgent', 'failed'];

  // Set to false if you don't want **bold** / *italic* markdown syntax
  // already present in the source text to be interpreted.
  const PARSE_MARKDOWN_SYNTAX = true;
  // --------------------------------------------------------------------------

  // DEBUG: bump this on every edit so we can confirm a reload picked up
  // the latest file, independent of what #output shows.
  const DEBUG_VERSION = 5;

  // DEBUG: walk the prototype chain so getter-based properties (common in
  // the Tableau Extensions API's returned objects) show up too, not just
  // own enumerable properties like a plain JSON.stringify would catch.
  function inspectObject (obj) {
    const result = {};
    let o = obj;
    while (o && o !== Object.prototype) {
      Object.getOwnPropertyNames(o).forEach((key) => {
        if (key === 'constructor') return;
        try {
          const val = obj[key];
          if (typeof val !== 'function') result[key] = val;
        } catch (e) {
          result[key] = `<error: ${e.message}>`;
        }
      });
      o = Object.getPrototypeOf(o);
    }
    return result;
  }

  const output = document.getElementById('output');
  const debugVersionEl = document.getElementById('debug-version');
  if (debugVersionEl) debugVersionEl.textContent = `v${DEBUG_VERSION}`;

  // DEBUG: surface any error directly in the extension pane instead of
  // failing silently, since Tableau Desktop's embedded webview can't be
  // attached to Safari's Web Inspector on this machine.
  function showError (label, err) {
    output.style.color = '#b00020';
    output.style.whiteSpace = 'pre-wrap';
    output.textContent = `[${label}] ${err && err.message ? err.message : err}\n\n${err && err.stack ? err.stack : ''}`;
  }

  window.addEventListener('error', (e) => showError('window.onerror', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => showError('unhandledrejection', e.reason));

  window.onload = tableau.extensions.initializeAsync().then(() => {
    const worksheet = tableau.extensions.worksheetContent.worksheet;

    const updateAndRender = async () => {
      try {
        const encodingMap = await getEncodingMap(worksheet);
        const fieldName = encodingMap['text'];

        if (!fieldName) {
          output.textContent = 'Drag a field onto the "Text" encoding on the Marks card.';
          return;
        }

        const rows = await getSummaryDataTable(worksheet);
        if (rows.length === 0) {
          output.textContent = '(no data)';
          return;
        }

        // Assumes the worksheet is filtered/scoped down to a single record.
        // If there are multiple rows, this takes the first one - adjust here
        // if you want to loop and render several.
        const rawValue = rows[0][fieldName];
        if (rawValue === undefined) {
          showError('field lookup', new Error(
            `fieldName is not a usable string key. typeof=${typeof fieldName}\n` +
            `fieldName contents: ${JSON.stringify(inspectObject(fieldName))}\n` +
            `Available columns: [${Object.keys(rows[0]).join(', ')}]`
          ));
          return;
        }
        const text = rawValue.value !== undefined ? String(rawValue.value) : '';

        output.style.color = '';
        output.innerHTML = markupText(text);
      } catch (err) {
        showError('updateAndRender', err);
      }
    };

    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, updateAndRender);
    updateAndRender();
  }).catch((err) => showError('initializeAsync', err));

  // Turns raw text into styled HTML per the rules above.
  function markupText (text) {
    let escaped = escapeHtml(text);

    // Step 1: wrap numbers and keyword matches using placeholder tokens
    // (avoids the markdown-lite pass below getting confused by real HTML tags).
    escaped = escaped.replace(/\b\d+(\.\d+)?\b/g, (m) => `\u0001N\u0002${m}\u0001/N\u0002`);

    BIG_WORDS.forEach((word) => {
      const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      escaped = escaped.replace(re, (m) => `\u0001B\u0002${m}\u0001/B\u0002`);
    });

    ITALIC_WORDS.forEach((word) => {
      const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      escaped = escaped.replace(re, (m) => `\u0001K\u0002${m}\u0001/K\u0002`);
    });

    // Step 2: optionally interpret literal **bold** / *italic* markdown syntax
    // that came straight from the SQL text.
    if (PARSE_MARKDOWN_SYNTAX) {
      escaped = escaped
        .replace(/\*\*(.+?)\*\*/g, '\u0001MB\u0002$1\u0001/MB\u0002')
        .replace(/\*(.+?)\*/g, '\u0001MI\u0002$1\u0001/MI\u0002');
    }

    // Step 3: swap placeholders for real tags.
    escaped = escaped
      .replace(/\u0001N\u0002/g, '<span class="num">').replace(/\u0001\/N\u0002/g, '</span>')
      .replace(/\u0001B\u0002/g, '<span class="big">').replace(/\u0001\/B\u0002/g, '</span>')
      .replace(/\u0001K\u0002/g, '<span class="kw">').replace(/\u0001\/K\u0002/g, '</span>')
      .replace(/\u0001MB\u0002/g, '<b>').replace(/\u0001\/MB\u0002/g, '</b>')
      .replace(/\u0001MI\u0002/g, '<i>').replace(/\u0001\/MI\u0002/g, '</i>');

    return escaped;
  }

  function escapeHtml (str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeRegex (str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---- Extensions API helpers (same pattern Tableau's own samples use) -----
  function convertToListOfNamedRows (dataTablePage) {
    const rows = [];
    const columns = dataTablePage.columns;
    const data = dataTablePage.data;
    for (let i = 0; i < data.length; i++) {
      const row = {};
      for (let j = 0; j < columns.length; j++) {
        row[columns[j].fieldName] = data[i][columns[j].index];
      }
      rows.push(row);
    }
    return rows;
  }

  async function getSummaryDataTable (worksheet) {
    let rows = [];
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    for (let page = 0; page < reader.pageCount; page++) {
      const dataTablePage = await reader.getPageAsync(page);
      rows = rows.concat(convertToListOfNamedRows(dataTablePage));
    }
    await reader.releaseAsync();
    return rows;
  }

  async function getEncodingMap (worksheet) {
    const visualSpec = await worksheet.getVisualSpecificationAsync();
    const encodingMap = {};
    if (visualSpec.activeMarksSpecificationIndex < 0) return encodingMap;
    const marksCard = visualSpec.marksSpecifications[visualSpec.activeMarksSpecificationIndex];
    for (const encoding of marksCard.encodings) {
      // encoding.field comes back as a Field object (not a plain string) on
      // this Tableau version - its .name matches the column key returned by
      // getSummaryDataReaderAsync.
      encodingMap[encoding.id] = typeof encoding.field === 'string' ? encoding.field : encoding.field.name;
    }
    return encodingMap;
  }
})();
