import { PLATFORMS } from '../core.mjs';
import { HISTORY_PLATFORMS } from './history-import.mjs';
import { previewSolvedImport } from './solved-import.mjs';

export function mountSolvedImport({ getState, getLibrary, rpc, render, toast }) {
  const $ = id => document.getElementById(id);
  let preview, generations, busy = false;
  function reset() { preview = null; $('applySolvedImport').disabled = true; $('solvedImportPreview').replaceChildren(); }
  function update() {
    const state = getState(), selected = $('historyPlatform').value;
    $('historyPlatform').replaceChildren(...Object.keys(state.accounts).filter(platform => platform !== 'tuf').map(platform => {
      const option = document.createElement('option'); option.value = platform; option.textContent = PLATFORMS[platform].name; return option;
    }));
    if (selected !== 'tuf' && state.accounts[selected]) $('historyPlatform').value = selected;
    const platform = $('historyPlatform').value, account = state.accounts[platform], job = account?.historyImport;
    const supported = HISTORY_PLATFORMS.includes(platform);
    $('startHistoryImport').disabled = busy || !account || !supported || ['running', 'waiting-tab'].includes(job?.status);
    $('resumeHistoryImport').hidden = !job || !['error', 'cancelled', 'paused', 'waiting-tab'].includes(job.status);
    $('resumeHistoryImport').disabled = busy;
    $('cancelHistoryImport').hidden = !['running', 'waiting-tab'].includes(job?.status);
    const detail = !account ? 'Connect a platform in Settings first.' : !supported ? 'Use URLs or a file below for this platform.' : ['leetcode', 'code360'].includes(platform) ? `Keep ${PLATFORMS[platform].name} open and signed in as the connected account.` : 'Keep Chrome open during the scan.';
    const status = { running: 'Importing', complete: 'History imported', cancelled: 'Paused', paused: 'Paused', 'waiting-tab': 'Waiting for tab', error: 'Needs attention' };
    $('historyImportStatus').textContent = `${detail}${job ? ` ${status[job.status] || 'Needs attention'} · ${job.pages || 0} pages · ${job.solved || 0} solved.${job.skipped ? ` ${job.skipped} skipped.` : ''}${job.error ? ` ${job.error}` : ''}` : ''}`;
    $('historyImportStatus').title = `Progress is saved after each page.${platform === 'code360' ? ' Only coding problems are imported; unavailable links and MCQs are skipped.' : ''}`;
  }
  $('openSolvedImport').addEventListener('click', () => { update(); $('solvedImportDialog').showModal(); });
  $('closeSolvedImport').addEventListener('click', () => $('solvedImportDialog').close());
  $('historyPlatform').addEventListener('change', update);
  for (const [id, command] of [['startHistoryImport', 'start'], ['resumeHistoryImport', 'resume'], ['cancelHistoryImport', 'cancel']]) {
    $(id).addEventListener('click', async () => {
      busy = true; update();
      try { await rpc('history', { platform: $('historyPlatform').value, command }); render(); }
      catch (error) { toast(error.message, true); }
      finally { busy = false; update(); }
    });
  }
  $('solvedImportText').addEventListener('input', reset);
  $('solvedImportFile').addEventListener('change', async () => {
    reset();
    try {
      const file = $('solvedImportFile').files[0];
      if (!file) return;
      if (file.size > 2_000_000) throw new Error('Import must be smaller than 2 MB.');
      $('solvedImportText').value = await file.text();
    } catch (error) { toast(error.message, true); }
  });
  $('previewSolvedImport').addEventListener('click', () => {
    reset();
    try {
      const state = getState();
      preview = previewSolvedImport($('solvedImportText').value, state.accounts, getLibrary());
      generations = Object.fromEntries(Object.entries(state.accounts).map(([platform, account]) => [platform, account.generation]));
      const summary = document.createElement('p');
      summary.textContent = `${preview.records.length} new · ${preview.duplicates} duplicates · ${preview.unresolved.length} unresolved. Undated; activity and profile totals stay the same.`;
      const list = document.createElement('ul');
      for (const item of preview.records.slice(0, 20)) { const row = document.createElement('li'); row.textContent = `${PLATFORMS[item.platform].name}: ${item.title}`; list.append(row); }
      for (const item of preview.unresolved.slice(0, 20)) { const row = document.createElement('li'); row.textContent = `Row ${item.row}: ${item.reason}`; list.append(row); }
      $('solvedImportPreview').replaceChildren(summary, list);
      $('applySolvedImport').disabled = !preview.records.length;
    } catch (error) { toast(error.message, true); }
  });
  $('applySolvedImport').addEventListener('click', async () => {
    if (!preview) return;
    $('applySolvedImport').disabled = true;
    try {
      await rpc('import-solved', { records: preview.records, generations });
      toast(`Imported ${preview.records.length} solved questions.`);
      reset(); render();
    } catch (error) { reset(); toast(error.message, true); }
  });
  return { render: update };
}
