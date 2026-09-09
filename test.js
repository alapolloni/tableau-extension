'use strict';

(function () {
  const statusEl = document.getElementById('status');
  const detailsEl = document.getElementById('details');

  function addDetail(label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    detailsEl.appendChild(dt);
    detailsEl.appendChild(dd);
  }

  function showOk () {
    statusEl.className = 'ok';
    statusEl.textContent = '✅ Extension loaded and initialized successfully.';
  }

  function showError (err) {
    statusEl.className = 'err';
    statusEl.textContent = '❌ tableau.extensions.initializeAsync() failed: ' + (err && err.message ? err.message : String(err));
  }

  addDetail('Page served from', window.location.href);
  addDetail('tableau object present at load', typeof window.tableau !== 'undefined' ? 'yes' : 'no - library did not load, check the script path/MIME type/CORS');

  if (typeof window.tableau === 'undefined') {
    statusEl.className = 'err';
    statusEl.textContent = '❌ tableau.extensions.1.latest.min.js never loaded - the page itself was served, but the library script tag failed. Check that file is actually present at this path and served with a JS/plain-text content type, not blocked by CSP.';
    return;
  }

  tableau.extensions.initializeAsync().then(() => {
    showOk();
    try {
      const env = tableau.extensions.environment;
      addDetail('Tableau context', env.context);
      addDetail('Tableau version', env.tableauVersion);
      addDetail('Extension API version', env.apiVersion);
      addDetail('Worksheet name', tableau.extensions.worksheetContent.worksheet.name);
    } catch (e) {
      addDetail('Environment read error', e.message);
    }
  }, (err) => {
    showError(err);
  });
})();
