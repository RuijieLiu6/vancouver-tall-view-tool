/* Vista keeps new application data in memory or project files, never browser
 * application storage. Clean up only known old Vista data on this origin.
 * User parcel edits are removed only after a confirmed project-file backup.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) {
    const policy = api.createPolicy(root);
    root.VistaStoragePolicy = {...policy, ready:policy.cleanup()};
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const KEYS = Object.freeze(['vancouver-view-lab-intro-seen/1', 'vista-view-height-v1']);
  const DATABASES = Object.freeze(['vista-imagine-public', 'vista-imagine-packed']);
  const EDIT_PREFIX = 'vista-imagine-edits/';
  const ASSUMPTION_KEY = 'vista-imagine-upper-assumption/1';
  const MAX_KEYS = 10000, MAX_EDIT_KEYS = 250, MAX_EDIT_BYTES = 5000000;
  function createPolicy(environment, options = {}) {
    const env = environment || {}, timeoutMs = Math.max(10, Math.min(5000, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500));
    let pending = null, state = {status:'idle', removedKeys:[], databases:[], legacyStudyCount:0, migratedStudyCount:0, issues:[]};
    const getState = () => JSON.parse(JSON.stringify(state));
    function updateStatus(report) {
      const doc = env.document;
      if (!doc) return;
      const show = () => {
        const status = doc.getElementById('storage-status');
        if (!status) return;
        status.textContent = report.status === 'complete' ? 'Storage: temporary' : 'Storage: cleanup pending';
        const deleted = report.databases.filter(d => d.status === 'deleted').length;
        const blocked = report.databases.filter(d => d.status !== 'deleted').map(d => `${d.name}: ${d.status}`);
        status.title = `${report.removedKeys.length} known legacy Vista key cleanup operations completed; ${deleted}/${DATABASES.length} public map databases cleared; ${report.migratedStudyCount}/${report.legacyStudyCount} legacy study records backed up and removed. New Vista application data uses page memory or project files; no new browser application storage writes.${blocked.length ? ' Pending databases: ' + blocked.join(', ') + '.' : ''}${report.legacyStudyCount > report.migratedStudyCount ? ' Legacy study records remain until a confirmed project-file backup.' : ''}`;
      };
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', show, {once:true}); else show();
    }
    function notice(report) {
      const doc = env.document;
      if (!doc || report.status === 'complete') return;
      const show = () => {
        if (!doc.body || doc.getElementById('vista-storage-notice')) return;
        const section = doc.createElement('section'); section.id = 'vista-storage-notice'; section.setAttribute('role', 'status');
        section.style.cssText = 'position:fixed;z-index:10000;left:12px;right:12px;bottom:12px;max-width:640px;margin:auto;padding:14px;background:#fffdf7;color:#233a36;border:1px solid #79918a;font:14px/1.5 system-ui;box-shadow:0 4px 24px #0002;';
        const message = doc.createElement('p'); message.style.margin = '0 0 8px';
        const blocked = report.databases.some(d => d.status === 'blocked');
        message.textContent = report.legacyStudyCount > report.migratedStudyCount
          ? 'Older Vista study settings or parcel edits are still saved in this browser. They were kept to avoid losing your work. Open the local project with its backup service to move them into a project file. New edits stay in memory for this page.'
          : blocked ? 'An older Vista tab is keeping its map cache open. Close that Vista tab, then reload this page to finish clearing the old cache. New calculations stay in memory or project files.'
            : 'Vista could not finish clearing its old application storage. New calculations stay in memory or project files. Reload after closing older Vista tabs to retry.';
        section.appendChild(message);
        const close = doc.createElement('button'); close.type = 'button'; close.textContent = 'Dismiss'; close.addEventListener('click', () => section.remove()); section.appendChild(close);
        section.addEventListener('keydown', event => {if (/^Arrow|^[ijkl]$/i.test(event.key)) event.stopPropagation();});
        doc.body.appendChild(section);
      };
      if (doc.body) show(); else doc.addEventListener('DOMContentLoaded', show, {once:true});
    }
    function deleteDatabase(name, storage) {
      return new Promise(resolve => {
        let done = false;
        const finish = status => {if (done) return; done = true; clearTimeout(timer); resolve({name, status});};
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        try {
          if (typeof storage?.deleteDatabase !== 'function') {finish('unavailable'); return;}
          const request = storage.deleteDatabase(name);
          request.onsuccess = () => finish('deleted');
          request.onerror = () => finish('error');
          request.onblocked = () => finish('blocked');
        } catch (_) {finish('unavailable');}
      });
    }
    function cleanup() {
      if (pending) return pending;
      pending = (async () => {
        state = {status:'cleaning', removedKeys:[], databases:[], legacyStudyCount:0, migratedStudyCount:0, issues:[]};
        let local = null, database = null;
        try {local = env.localStorage;} catch (_) {state.issues.push('local-storage-unavailable');}
        try {database = env.indexedDB;} catch (_) {state.issues.push('database-storage-unavailable');}
        if (local) {
          for (const key of KEYS) try {local.removeItem(key); state.removedKeys.push(key);} catch (_) {state.issues.push('legacy-key-removal-failed');}
          const entries = []; let bytes = 0, bounded = true;
          try {
            const count = local.length;
            if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid-key-count');
            if (count > MAX_KEYS) {bounded = false; state.issues.push('legacy-key-scan-limit');}
            for (let i = 0; i < Math.min(count, MAX_KEYS); i++) {
              const key = local.key(i);
              if (typeof key !== 'string' || key !== ASSUMPTION_KEY && !key.startsWith(EDIT_PREFIX)) continue;
              state.legacyStudyCount++;
              if (entries.length >= MAX_EDIT_KEYS) {bounded = false; continue;}
              const value = local.getItem(key);
              if (typeof value !== 'string' || bytes + (key.length + value.length) * 2 > MAX_EDIT_BYTES) {bounded = false; continue;}
              bytes += (key.length + value.length) * 2; entries.push({key, value});
            }
          } catch (_) {bounded = false; state.issues.push('legacy-study-read-failed');}
          if (!bounded) state.issues.push('legacy-study-backup-limit');
          if (entries.length && bounded) {
            const backup = options.migrateLegacyEdits || (typeof env.VistaHeightProjectStore?.backupLegacy === 'function' ? entries => env.VistaHeightProjectStore.backupLegacy(entries) : null);
            let confirmed = false, timer;
            try {
              if (backup) confirmed = await Promise.race([
                Promise.resolve().then(() => backup(entries)),
                new Promise(resolve => {timer = setTimeout(() => {state.issues.push('legacy-study-backup-timeout'); resolve(false);}, timeoutMs);}),
              ]) === true;
            } catch (_) {state.issues.push('legacy-study-backup-failed');}
            finally {clearTimeout(timer);}
            if (confirmed) for (const {key, value} of entries) try {
              // Do not erase a later edit made by an older Vista tab while its
              // original value was being backed up.
              if (local.getItem(key) !== value) {state.issues.push('legacy-study-changed-during-backup'); continue;}
              local.removeItem(key); state.removedKeys.push(key); state.migratedStudyCount++;
            } catch (_) {state.issues.push('legacy-study-removal-failed');}
          }
        }
        state.databases = await Promise.all(DATABASES.map(name => deleteDatabase(name, database)));
        if (state.legacyStudyCount > state.migratedStudyCount) state.issues.push('legacy-studies-await-project-backup');
        state.issues = [...new Set(state.issues)];
        state.status = state.issues.length || state.databases.some(d => d.status !== 'deleted') ? 'pending' : 'complete';
        const report = getState(); updateStatus(report); notice(report); return report;
      })();
      return pending;
    }
    return {cleanup, getState};
  }
  return {createPolicy, KEYS, DATABASES, EDIT_PREFIX, ASSUMPTION_KEY};
});
