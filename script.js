/***********************
 * CONFIGURAÇÕES
 ***********************/
const API_BASE = "https://fotos-lt35.onrender.com";
const ENDPOINTS = {
  list: `${API_BASE}/list_files`,
  upload: `${API_BASE}/upload`,
  delete: `${API_BASE}/delete`,
};

const BATCH_SIZE = 1000;
const UPLOAD_CONCURRENCY = 5;
const CACHE_KEY = "galleryIndex.v6";
const CACHE_TTL = 24 * 60 * 60 * 1000;

/***********************
 * ELEMENTOS DE UI
 ***********************/
const dropArea = document.getElementById("drop");
const inputFile = document.querySelector('input[type="file"]');
const triggerFile = document.getElementById("triggerFile");
const btnUpload = document.querySelector(".importar");
const listFiles = document.querySelector(".list-files");
const fileList = document.getElementById("fileList");
const searchInput = document.getElementById("searchInput");
const loadingModal = document.getElementById("loadingModal");
const loadingText = document.getElementById("loadingText");
const progressInner = document.getElementById("progressInner");
const confirmModal = document.getElementById("confirmModal");
const confirmText = document.getElementById("confirmText");
const cancelDelete = document.getElementById("cancelDelete");
const confirmDelete = document.getElementById("confirmDelete");
let pendingDelete = null;

/***********************
 * ESTADO
 ***********************/
const state = {
  items: [],
  filtered: [],
  renderedCount: 0,
  loading: false,
  searchTerm: "",
  paused: false,
  totalLoaded: 0,
  totalExpected: 0
};

/***********************
 * TOAST
 ***********************/
function showToast(msg, type = "success") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i>${
    type === "error" ? "❌" : type === "warning" ? "⚠️" : "✅"
  }</i><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/***********************
 * MODAL
 ***********************/
function showLoading(msg = "⏳ Processando...") {
  loadingModal?.classList.remove("hidden");
  loadingText.textContent = msg;
  progressInner.style.width = "0%";
}
function setProgress(pct) {
  progressInner.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideLoading(msg = "✅ Concluído!") {
  loadingText.textContent = msg;
  setProgress(100);
  setTimeout(() => loadingModal.classList.add("hidden"), 800);
}

/***********************
 * CACHE
 ***********************/
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.storedAt > CACHE_TTL) return null;
    return obj.items;
  } catch {
    return null;
  }
}
function writeCache(items) {
  try {
    if (items.length > 1000) return; // evita travar localStorage
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), items })
    );
  } catch (e) {
    console.warn("Cache write failed:", e);
  }
}

/***********************
 * RENDERIZAÇÃO
 ***********************/
const lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      lazyObserver.unobserve(img);
    }
  });
});

async function renderNextBatch() {
  const PAGE_SIZE = 1000;
  const start = state.renderedCount;
  const end = Math.min(start + PAGE_SIZE, state.filtered.length);
  if (start >= end) return;

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
  const f = state.filtered[i];

  const li = document.createElement("li");
  li.className = "file-item";
  li.dataset.name = f.name;          // <- guardar o nome no dataset para o delegado

  const img = document.createElement("img");
  img.dataset.src = f.url;
  img.width = 40;
  img.height = 40;
  img.loading = "lazy";
  img.style.borderRadius = "6px";
  img.style.objectFit = "cover";
  lazyObserver.observe(img);

  const nameSpan = document.createElement("span");
  nameSpan.className = "file-name";
  nameSpan.textContent = f.name;
  nameSpan.addEventListener("click", () => window.open(f.url, "_blank"));

  const div = document.createElement("div");
  div.style.display = "flex";
  div.style.alignItems = "center";
  div.style.gap = "10px";
  div.appendChild(img);
  div.appendChild(nameSpan);

  // botão de deletar (sem listener aqui – usaremos delegação global)
  const btn = document.createElement("button");
  btn.className = "delete-btn";
  btn.title = "Excluir";
  btn.innerHTML = `<i class="fa fa-trash"></i>`;

  // guarda o nome do arquivo no <li> para recuperar depois
  li.dataset.filename = f.name;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const filename = li.dataset.filename;
    pendingDelete = { filename, element: li };
    confirmText.textContent = `Deseja excluir "${filename}"?`;
    confirmModal.classList.remove("hidden");
  });

  li.appendChild(div);
  li.appendChild(btn);
  fragment.appendChild(li);

  if (i % 200 === 0) await new Promise(r => requestAnimationFrame(r));
}


  fileList.appendChild(fragment);
  state.renderedCount = end;
}

function clearList() {
  fileList.innerHTML = "";
  state.renderedCount = 0;
}
function ensureFiltered() {
  const q = state.searchTerm.trim().toLowerCase();
  state.filtered = q
    ? state.items.filter((it) => it.name.toLowerCase().includes(q))
    : state.items;
}
function resetAndRenderAll() {
  clearList();
  ensureFiltered();
  renderNextBatch();
}
window.state = state;

function openConfirm(name, liEl) {
  pendingDelete = { filename: name, element: liEl };
  if (confirmText) confirmText.textContent = `Deseja excluir "${name}"?`;
  if (confirmModal) confirmModal.classList.remove("hidden");
}
function closeConfirm() {
  if (confirmModal) confirmModal.classList.add("hidden");
  pendingDelete = null;
}

// Esc fecha o modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmModal.classList.contains("hidden")) {
    closeConfirm();
  }
});

fileList.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".delete-btn");
  if (!btn) return;
  const li = btn.closest("li.file-item");
  if (!li) return;
  const filename = li.dataset.name || "";
  pendingDelete = { filename, element: li };
  if (confirmText) confirmText.textContent = `Deseja excluir "${filename}"?`;
  if (confirmModal) confirmModal.classList.remove("hidden");
});

/***********************
 * BUSCA
 ***********************/
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
searchInput.addEventListener("input", debounce(() => {
  state.searchTerm = searchInput.value || "";
  resetAndRenderAll();
}, 300));

/***********************
 * PAINEL DE PROGRESSO
 ***********************/
const progressGlobal = document.createElement("div");
progressGlobal.style = `
  position: fixed; bottom: 14px; right: 14px; z-index: 99999;
  background: rgba(0,0,0,.65); color: #fff; padding: 8px 12px;
  border-radius: 8px; font: 13px/1.2 Inter,system-ui;
  display: none; cursor: pointer; backdrop-filter: blur(4px);
`;
document.body.appendChild(progressGlobal);
progressGlobal.addEventListener("click", () => {
  state.paused = !state.paused;
  progressGlobal.textContent = state.paused
    ? `⏸️ Pausado (${state.totalLoaded.toLocaleString("pt-BR")} / ${state.totalExpected.toLocaleString("pt-BR")})`
    : `▶️ Retomando...`;
});

/***********************
 * LISTAR PAGINADO
 ***********************/
async function fetchAllPagesAndRender() {
  let allItems = [];
  let token = null;
  let page = 1;
  state.paused = false;
  state.totalLoaded = 0;
  progressGlobal.style.display = "block";
  progressGlobal.textContent = "📸 Iniciando carregamento...";

  // --- Antes do loop começar ---
  const spinner = document.querySelector(".spinner");
  if (spinner) {
    spinner.classList.remove("done");
    spinner.classList.add("loading");
  }
  while (true) {
    if (state.paused) await new Promise(r => {
      const iv = setInterval(() => {
        if (!state.paused) { clearInterval(iv); r(); }
      }, 300);
    });
    
    const url = token
      ? `${ENDPOINTS.list}?token=${encodeURIComponent(token)}&max=5000`
      : `${ENDPOINTS.list}?max=5000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao buscar página ${page}`);
    const data = await res.json();

    const items = Array.isArray(data) ? data : (data.items || []);
    allItems.push(...items);
    state.totalLoaded = allItems.length;
    state.totalExpected = data.has_more ? page * 5000 : allItems.length;
    if (page % 2 === 0 || !data.has_more)
      progressGlobal.textContent =
        `📸 ${state.totalLoaded.toLocaleString("pt-BR")}`;

    state.items = allItems.slice();
    resetAndRenderAll();
    window.state = state; // 

    if (!data.has_more || !data.next_token) break;
    token = data.next_token;
    page++;
  }

  progressGlobal.textContent = `✅ ${allItems.length.toLocaleString("pt-BR")} imagens carregadas`;
  setTimeout(() => (progressGlobal.style.display = "none"), 4000);

  allItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  writeCache(allItems);
}

/***********************
 * CARREGAMENTO INICIAL
 ***********************/
async function loadGallery() {
  const cached = readCache();
  if (cached?.length) {
    state.items = cached;
    resetAndRenderAll();
  } else fileList.innerHTML = "<li style='padding:10px;color:#888'>Carregando...</li>";

  try {
    state.loading = true;
    await fetchAllPagesAndRender();
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar galeria", "error");
  } finally {
    state.loading = false;
  }
}

/***********************
 * CONVERSÃO SEGURO WEBP
 ***********************/
async function processImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    let finished = false;
    const finalize = (r = null) => { if (!finished) { finished = true; resolve(r); } };

    const globalTimeout = setTimeout(() => {
      console.warn("⏱️ Timeout global:", file.name);
      finalize(null);
    }, 4000);

    reader.onload = (e) => {
      const img = new Image();
      const imgTimeout = setTimeout(() => {
        console.warn("⚠️ Timeout decode:", file.name);
        finalize(null);
      }, 3000);

      img.onload = () => {
        clearTimeout(imgTimeout); clearTimeout(globalTimeout);
        try {
          const maxSide = 300;
          let { width, height } = img;
          if (width >= height) { height = Math.round((height / width) * maxSide); width = maxSide; }
          else { width = Math.round((width / height) * maxSide); height = maxSide; }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) return finalize(null);
            const base = file.name.split(".")[0];
            finalize(new File([blob], `${base}.webp`, { type: "image/webp" }));
          }, "image/webp", 0.85);
        } catch { finalize(null); }
      };
      img.onerror = () => { finalize(null); };
      img.src = e.target.result;
    };
    reader.onerror = () => finalize(null);
    try { reader.readAsDataURL(file); } catch { finalize(null); }
  });
}

/***********************
 * UPLOAD
 ***********************/
async function uploadOne(webpFile) {
  const form = new FormData();
  form.append("file", webpFile);
  const res = await fetch(ENDPOINTS.upload, { method: "POST", body: form });
  const result = await res.json();
  if (!res.ok) throw new Error(result?.error || "Falha no upload");
  return result;
}
async function runInBatches(items, worker, concurrency, onProgress) {
  let inFlight = 0, idx = 0, done = 0;
  return new Promise((resolve) => {
    const results = [];
    function next() {
      if (done === items.length) return resolve(results);
      while (inFlight < concurrency && idx < items.length) {
        const i = idx++;
        inFlight++;
        worker(items[i])
          .then((r) => results[i] = { ok: true, value: r })
          .catch((e) => results[i] = { ok: false, error: e })
          .finally(() => {
            inFlight--; done++; onProgress?.(done, items.length); next();
          });
      }
    }
    next();
  });
}
/***********************
 * LISTA DE ARQUIVOS (preview antes do upload)
 ***********************/
inputFile.addEventListener("change", () => {
  listFiles.innerHTML = "";
  if (!inputFile.files.length) return;

  const validFiles = [];
  const invalidFiles = [];

  Array.from(inputFile.files).forEach((file) => {
    const base = file.name.split(".")[0];
    const isValid = /^\d+$/.test(base);

    // Ícones por extensão
    const ext = file.name.split(".").pop().toLowerCase();
    const iconMap = {
      jpg: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
      jpeg: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
      png: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
      webp: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
      gif: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
      default: "https://cdn-icons-png.flaticon.com/512/833/833524.png",
    };
    const iconUrl = iconMap[ext] || iconMap.default;

    // Linha da lista
    const row = document.createElement("div");
    row.className = "file";
    row.style.cssText = `
      display:flex;align-items:center;gap:10px;
      padding:6px 10px;margin:2px 0;
      background:#fafafa;border-radius:6px;
    `;
    row.innerHTML = `
      <img src="${iconUrl}" style="width:32px;height:32px;opacity:.9;border-radius:6px;" />
      <span class="file-name" style="flex:1;">${file.name}</span>
      <div class="progress" style="flex:0 0 80px;height:4px;background:#eee;border-radius:4px;overflow:hidden;">
        <div class="bar" style="width:0;height:100%;background:#f5c400;"></div>
      </div>
    `;
    listFiles.appendChild(row);

    if (!isValid) {
      invalidFiles.push(file.name);
      row.style.opacity = "0.5";
      row.style.filter = "grayscale(1)";
      row.querySelector(".file-name").style.color = "#c33";
      setTimeout(() => row.remove(), 1000);
    } else {
      validFiles.push(file);
    }
  });

  if (invalidFiles.length) {
    showToast(
      `⚠️ ${invalidFiles.length} ignorado(s): ${invalidFiles.join(", ")}`,
      "warning"
    );
  }

  if (!validFiles.length) {
    btnUpload.classList.remove("active");
    showToast("Nenhum arquivo válido para upload.", "error");
    return;
  }

  // Ativa botão
  btnUpload.classList.add("active");
  btnUpload.style.display = "inline-block";
  btnUpload.disabled = false;

  // Substitui input apenas com válidos
  const dt = new DataTransfer();
  validFiles.forEach((f) => dt.items.add(f));
  inputFile.files = dt.files;
});

/***********************
 * BOTÃO UPLOAD
 ***********************/
btnUpload.addEventListener("click", async () => {
  if (!inputFile.files.length) return showToast("Nenhum arquivo selecionado", "warning");

  const allFiles = Array.from(inputFile.files);
  const validFiles = allFiles.filter((f) => /^\d+$/.test(f.name.split(".")[0]));
  if (!validFiles.length) return showToast("Nenhum arquivo válido.", "error");

  showLoading(`⬆️ Preparando ${validFiles.length} arquivo(s)...`);
  setProgress(5);
  btnUpload.disabled = true;

  const webps = [];
  for (let i = 0; i < validFiles.length; i++) {
    if (i % 20 === 0) await new Promise(r => requestAnimationFrame(r));
    loadingText.textContent = `🧪 Convertendo ${i + 1} / ${validFiles.length}`;
    const w = await processImage(validFiles[i]);
    if (w) webps.push(w);
    else showToast(`⚠️ ${validFiles[i].name} corrompida — ignorada`, "warning");
    setProgress(5 + (i / validFiles.length) * 20);
  }

  let lastPct = 25;
  const results = await runInBatches(webps, uploadOne, UPLOAD_CONCURRENCY, (done, total) => {
    const pct = 25 + Math.floor((done / total) * 60);
    if (pct > lastPct) {
      lastPct = pct;
      setProgress(pct);
      loadingText.textContent = `📤 Enviando ${done} / ${total}...`;
    }
  });

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  loadingText.textContent = "🔄 Atualizando galeria...";
  setProgress(92);
  await fetchAllPagesAndRender();
  hideLoading("✅ Envio finalizado!");
  showToast(`✅ ${sent} enviado(s) | ❌ ${failed} erro(s)`, failed ? "warning" : "success");
  btnUpload.disabled = false;
  btnUpload.classList.remove("active");
  listFiles.innerHTML = "";
  inputFile.value = "";
});

/***********************
 * EXCLUSÃO
 ***********************/
let deletingNow = false;

confirmDelete.addEventListener("click", async () => {
  if (!pendingDelete || deletingNow) return;
  deletingNow = true;

  // feedback visual rápido (sem bloquear com spinner grande)
  confirmDelete.disabled = true;
  cancelDelete.disabled = true;

  try {
    const filename = pendingDelete.filename;

    // chama API
    const res = await fetch(ENDPOINTS.delete, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename })
    });

    let result = {};
    try { result = await res.json(); } catch { /* sem corpo json */ }

    if (!res.ok) {
      showToast(result?.error || "Erro ao excluir", "error");
      return;
    }

    // === Atualiza STATE (remove do items e filtered)
    state.items = state.items.filter(it => it.name !== filename);
    state.filtered = state.filtered.filter(it => it.name !== filename);

    // === Remove do DOM imediatamente
    if (pendingDelete.element && pendingDelete.element.parentNode) {
      pendingDelete.element.remove();
    }

    // regrava cache (limitado no teu writeCache)
    writeCache(state.items);

    // se quiser re-renderizar o resto (mantém busca/scroll atuais)
    // resetAndRenderAll(); // opcional — normalmente não precisa

    showToast(result?.message || `🗑️ "${filename}" removido`);
  } catch (err) {
    console.error("Delete error:", err);
    showToast("Erro na exclusão", "error");
  } finally {
    pendingDelete = null;
    confirmModal.classList.add("hidden");
    confirmDelete.disabled = false;
    cancelDelete.disabled = false;
    deletingNow = false;
  }
});

cancelDelete.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
  pendingDelete = null;
});


cancelDelete.addEventListener("click", () => {
  closeConfirm();
});

cancelDelete.addEventListener("click", () => confirmModal.classList.add("hidden"));

/***********************
 * DRAG & DROP
 ***********************/
triggerFile?.addEventListener("click", (e) => (e.preventDefault(), inputFile.click()));
dropArea.addEventListener("dragover", (e) => { e.preventDefault(); dropArea.classList.add("active"); });
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"));
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("active");
  inputFile.files = e.dataTransfer.files;
  inputFile.dispatchEvent(new Event("change"));
});

/***********************
 * START
 ***********************/
window.addEventListener("DOMContentLoaded", loadGallery);
