// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  docId: null,
  filename: null,
  totalPages: 0,
  ranges: [],        // [{ start, end }]
  result: null,      // { markdown, txt, pages_processed }
};

// ─── DOM helpers ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function setStep(n) {
  [1, 2, 3].forEach((i) => {
    const dot = $(`step${i}-dot`);
    if (i < n) {
      dot.className = 'w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-xs font-bold';
    } else if (i === n) {
      dot.className = 'w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold';
    } else {
      dot.className = 'w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold';
    }
  });
}

// ─── Upload ──────────────────────────────────────────────────────────────────

const dropZone = $('drop-zone');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-blue-400', 'bg-slate-800');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-blue-400', 'bg-slate-800');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-blue-400', 'bg-slate-800');
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});

$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleUpload(file);
});

async function handleUpload(file) {
  hide('upload-error');

  const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!allowed.includes(ext)) {
    showError('upload-error', '支援格式：PDF、JPG、PNG');
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    showError('upload-error', '檔案超過 25MB 限制');
    return;
  }

  show('upload-progress');
  dropZone.style.pointerEvents = 'none';

  try {
    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '上傳失敗');
    }
    const data = await res.json();

    state.docId = data.doc_id;
    state.filename = data.filename;
    state.totalPages = data.total_pages;
    state.isImage = data.is_image;
    state.ranges = [];

    hide('section-upload');

    if (data.is_image) {
      // Images: skip page selection, go straight to OCR
      show('section-preview');
      setStep(2);
      $('page-count-label').textContent = '圖片（單頁）';
      loadThumbnails();
      // Auto-trigger OCR after thumbnail loads
      setTimeout(() => runOCR(), 500);
    } else {
      show('section-preview');
      setStep(2);
      $('page-count-label').textContent = `共 ${state.totalPages} 頁`;
      loadThumbnails();
      addRange(); // add first range by default
    }

  } catch (err) {
    showError('upload-error', err.message);
  } finally {
    hide('upload-progress');
    dropZone.style.pointerEvents = '';
  }
}

// ─── Thumbnails ───────────────────────────────────────────────────────────────

function loadThumbnails() {
  const grid = $('thumbnail-grid');
  grid.innerHTML = '';

  // Load up to 30 pages as thumbnails; lazy-load the rest
  const limit = Math.min(state.totalPages, 60);

  for (let i = 1; i <= limit; i++) {
    const card = document.createElement('div');
    card.className = 'thumbnail-card bg-slate-700';
    card.title = `Page ${i}`;

    const img = document.createElement('img');
    img.alt = `Page ${i}`;
    img.style.minHeight = '80px';
    img.style.background = '#1e293b';

    // Use IntersectionObserver for lazy loading
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          img.src = `/api/documents/${state.docId}/thumbnail/${i}`;
          observer.disconnect();
        }
      });
    }, { rootMargin: '100px' });

    observer.observe(card);

    const label = document.createElement('div');
    label.className = 'text-center text-xs text-slate-400 py-1';
    label.textContent = i;

    card.appendChild(img);
    card.appendChild(label);
    grid.appendChild(card);
  }

  if (state.totalPages > limit) {
    const note = document.createElement('div');
    note.className = 'col-span-3 text-xs text-slate-500 text-center py-2';
    note.textContent = `... 共 ${state.totalPages} 頁`;
    grid.appendChild(note);
  }
}

// ─── Page ranges ─────────────────────────────────────────────────────────────

function addRange() {
  const index = state.ranges.length;
  state.ranges.push({ start: 1, end: state.totalPages });
  renderRanges();
  // Set sensible default: next range starts after previous end
  if (index > 0) {
    const prev = state.ranges[index - 1];
    state.ranges[index].start = Math.min(prev.end + 1, state.totalPages);
    state.ranges[index].end = state.totalPages;
    renderRanges();
  }
}

function removeRange(index) {
  state.ranges.splice(index, 1);
  renderRanges();
}

function renderRanges() {
  const list = $('range-list');
  list.innerHTML = '';

  state.ranges.forEach((range, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3';

    row.innerHTML = `
      <span class="text-xs text-slate-500 w-16">Range ${i + 1}</span>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400">從</span>
        <input type="number" min="1" max="${state.totalPages}" value="${range.start}"
          class="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          onchange="updateRange(${i}, 'start', this.value)" />
        <span class="text-xs text-slate-400">到</span>
        <input type="number" min="1" max="${state.totalPages}" value="${range.end}"
          class="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          onchange="updateRange(${i}, 'end', this.value)" />
        <span class="text-xs text-slate-500">/ ${state.totalPages}</span>
      </div>
      ${state.ranges.length > 1 ? `
        <button onclick="removeRange(${i})" class="text-slate-500 hover:text-red-400 transition-colors ml-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      ` : ''}
    `;
    list.appendChild(row);
  });
}

function updateRange(index, field, value) {
  state.ranges[index][field] = parseInt(value) || 1;
}

// ─── OCR ─────────────────────────────────────────────────────────────────────

async function runOCR() {
  hide('ocr-error');

  if (!state.isImage) {
    // Validate ranges for PDF only
    for (const r of state.ranges) {
      if (r.start > r.end) {
        showError('ocr-error', `無效範圍：起始頁 (${r.start}) 不能大於結束頁 (${r.end})`);
        return;
      }
      if (r.start < 1 || r.end > state.totalPages) {
        showError('ocr-error', `頁碼超出範圍 (1–${state.totalPages})`);
        return;
      }
    }
  }

  const ocrBtn = $('ocr-btn');
  if (ocrBtn) ocrBtn.disabled = true;
  show('ocr-progress');

  try {
    const payload = {
      page_ranges: state.isImage ? [] : state.ranges.map((r) => [r.start, r.end]),
    };

    const res = await fetch(`/api/documents/${state.docId}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'OCR 失敗');
    }

    state.result = await res.json();
    showResults();

  } catch (err) {
    showError('ocr-error', err.message);
  } finally {
    if (ocrBtn) ocrBtn.disabled = false;
    hide('ocr-progress');
  }
}

// ─── Results ─────────────────────────────────────────────────────────────────

function showResults() {
  hide('section-preview');
  show('section-results');
  setStep(3);

  const pages = state.result.pages_processed;
  $('result-info').textContent = `已解析 ${pages} 頁`;

  $('panel-rendered').innerHTML = marked.parse(state.result.markdown);
  $('panel-raw').textContent = state.result.markdown;
  $('panel-txt').textContent = state.result.txt;

  switchTab('rendered');
}

function switchTab(tab) {
  ['rendered', 'raw', 'txt'].forEach((t) => {
    const panel = $(`panel-${t}`);
    const btn = $(`tab-${t}`);
    if (t === tab) {
      panel.classList.remove('hidden');
      btn.className = 'px-4 py-2 rounded-md text-sm font-medium bg-slate-700 text-white transition-colors';
    } else {
      panel.classList.add('hidden');
      btn.className = 'px-4 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white transition-colors';
    }
  });
}

function downloadResult(fmt) {
  window.location.href = `/api/documents/${state.docId}/download/${fmt}`;
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(state.result.markdown);
    const btn = document.querySelector('[onclick="copyMarkdown()"]');
    const original = btn.innerHTML;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> 已複製`;
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch {
    alert('複製失敗，請手動複製');
  }
}

// ─── Reset ───────────────────────────────────────────────────────────────────

function resetApp() {
  state.docId = null;
  state.filename = null;
  state.totalPages = 0;
  state.ranges = [];
  state.result = null;

  hide('section-preview');
  hide('section-results');
  show('section-upload');
  $('file-input').value = '';
  $('thumbnail-grid').innerHTML = '';
  $('range-list').innerHTML = '';
  hide('upload-error');
  hide('ocr-error');
  setStep(1);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function showError(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.classList.remove('hidden');
}
