/***********************
 * CONFIGURAÇÕES
 ***********************/
const API_BASE = "https://fotos-lt35.onrender.com";
const ENDPOINTS = {
  list: `${API_BASE}/list_files`,
  upload: `${API_BASE}/upload`,
  delete: `${API_BASE}/delete`,
};

// Renderização em lotes (UI)
const BATCH_SIZE = 500;
// Upload paralelo
const UPLOAD_CONCURRENCY = 5;
// Cache local
const CACHE_KEY = "galleryIndex.v5";
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
 * TOASTS
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
    toast.style.transform = "translateX(50%)";
    setTimeout(() => toast.remove(), 500);
  }, 3500);
}

/***********************
 * MODAL (SOMENTE UPLOAD/EXCLUSÃO)
 ***********************/
function showLoading(msg = "⏳ Processando...") {
  if (!loadingModal) return;
  loadingModal.classList.remove("hidden");
  loadingText.textContent = msg;
  progressInner.style.width = "0%";
}
function setProgress(pct) {
  if (!progressInner) return;
  progressInner.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideLoading(msg = "✅ Concluído!") {
  if (!loadingModal) return;
  loadingText.textContent = msg;
  setProgress(100);
  setTimeout(() => loadingModal.classList.add("hidden"), 900);
}

/***********************
 * DEBOUNCE (busca)
 ***********************/
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/***********************
 * CACHE LOCAL
 ***********************/
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.items || !obj.storedAt) return null;
    if (Date.now() - obj.storedAt > CACHE_TTL) return null;
    return obj.items;
  } catch {
    return null;
  }
}
function writeCache(items) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), items })
    );
  } catch (e) {
    console.warn("Cache write failed:", e);
  }
}

/***********************
 * RENDERIZAÇÃO (VIRTUAL + BATCH)
 ***********************/
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
function renderNextBatch() {
  const start = state.renderedCount;
  const end = Math.min(start + BATCH_SIZE, state.filtered.length);
  if (start >= end) return;

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const f = state.filtered[i];
    const li = document.createElement("li");
    li.className = "file-item";
    li.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <img src="${f.url}" width="40" height="40" style="border-radius:6px;object-fit:cover;">
        <span class="file-name">${f.name}</span>
      </div>
      <button class="delete-btn" title="Excluir"><i class="fa fa-trash"></i></button>
    `;
    li.querySelector(".file-name").addEventListener("click", () =>
      window.open(f.url, "_blank")
    );
    li.querySelector(".delete-btn").addEventListener("click", () => {
      pendingDelete = { filename: f.name, element: li };
      confirmText.textContent = `Deseja excluir "${f.name}"?`;
      confirmModal.classList.remove("hidden");
    });
    fragment.appendChild(li);
  }
  fileList.appendChild(fragment);
  state.renderedCount = end;
}
function resetAndRenderAll() {
  clearList();
  ensureFiltered();
  renderNextBatch();
}

/***********************
 * INFINITE SCROLL
 ***********************/
fileList.addEventListener("scroll", () => {
  if (fileList.scrollTop + fileList.clientHeight >= fileList.scrollHeight - 120) {
    renderNextBatch();
  }
});

/***********************
 * BUSCA (com debounce)
 ***********************/
searchInput.addEventListener(
  "input",
  debounce(() => {
    state.searchTerm = searchInput.value || "";
    resetAndRenderAll();
  }, 300)
);

/***********************
 * PAINEL INFERIOR (carregamento de galeria)
 ***********************/
const progressGlobal = document.createElement("div");
progressGlobal.style = `
  position: fixed; bottom: 14px; right: 14px; z-index: 99999;
  background: rgba(0,0,0,.65); color: #fff; padding: 8px 12px;
  border-radius: 8px; font: 13px/1.2 Inter,system-ui,Segoe UI,Arial;
  display: none; cursor: pointer; backdrop-filter: blur(4px);
`;
document.body.appendChild(progressGlobal);

progressGlobal.addEventListener("click", () => {
  state.paused = !state.paused;
  progressGlobal.textContent = state.paused
    ? `⏸️ Pausado (${state.totalLoaded.toLocaleString("pt-BR")} / ${state.totalExpected.toLocaleString("pt-BR")}) — Clique para retomar`
    : `▶️ Retomando...`;
});

/***********************
 * LISTAGEM PAGINADA (sem modal)
 ***********************/
async function fetchAllPagesAndRender() {
  let allItems = [];
  let token = null;
  let page = 1;

  state.paused = false;
  state.totalLoaded = 0;
  state.totalExpected = 0;
  progressGlobal.style.display = "block";
  progressGlobal.textContent = "📸 Iniciando carregamento... — Clique para pausar";

  while (true) {
    if (state.paused) {
      progressGlobal.textContent = `⏸️ Pausado (${state.totalLoaded.toLocaleString("pt-BR")} / ${state.totalExpected.toLocaleString("pt-BR")}) — Clique para retomar`;
      await new Promise((r) => {
        const iv = setInterval(() => {
          if (!state.paused) { clearInterval(iv); r(); }
        }, 300);
      });
    }

    const url = token ? `${ENDPOINTS.list}?token=${encodeURIComponent(token)}&max=1000` : `${ENDPOINTS.list}?max=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao buscar página ${page}`);
    const data = await res.json();

    const items = Array.isArray(data) ? data : (data.items || []);
    allItems.push(...items);

    state.totalLoaded = allItems.length;
    state.totalExpected = data.has_more ? page * 1000 : allItems.length;

    progressGlobal.textContent =
      `📸 ${state.totalLoaded.toLocaleString("pt-BR")} / ${state.totalExpected.toLocaleString("pt-BR")} — Clique para pausar`;

    // Atualiza UI incrementalmente
    state.items = allItems.slice();
    resetAndRenderAll();

    if (!data.has_more || !data.next_token) break;
    token = data.next_token;
    page++;
  }

  progressGlobal.textContent = `✅ ${allItems.length.toLocaleString("pt-BR")} imagens carregadas`;
  setTimeout(() => (progressGlobal.style.display = "none"), 5000);

  // Ordena e persiste no cache
  allItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  writeCache(allItems);
}

/***********************
 * CARREGAMENTO INICIAL
 ***********************/
async function loadGallery() {
  // 1) tenta cache
  const cached = readCache();
  if (cached?.length) {
    state.items = cached;
    resetAndRenderAll();
  } else {
    fileList.innerHTML = "<li style='padding:10px;color:#888'>Carregando...</li>";
  }

  // 2) busca paginado sem modal
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
window.state = state;

/***********************
 * PREVIEW + VALIDAÇÃO (apenas nomes numéricos)
 ***********************/
inputFile.addEventListener("change", () => {
  listFiles.innerHTML = "";
  if (!inputFile.files.length) return;

  const validFiles = [];
  const invalidFiles = [];

  Array.from(inputFile.files).forEach((file) => {
    const base = file.name.split(".")[0];
    const isValid = /^\d+$/.test(base);

   // Define ícones por extensão
  const ext = file.name.split('.').pop().toLowerCase();
  const iconMap = {
    jpg:  "https://cdn-icons-png.flaticon.com/512/337/337940.png",
    jpeg: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
    png:  "https://cdn-icons-png.flaticon.com/512/337/337940.png",
    webp: "https://cdn-icons-png.flaticon.com/512/337/337940.png",
    gif:  "https://cdn-icons-png.flaticon.com/512/337/337940.png",
    default: "https://cdn-icons-png.flaticon.com/512/833/833524.png"
  };
  const iconUrl = iconMap[ext] || iconMap.default;

  // Cria o item visual
  const row = document.createElement("div");
  row.className = "file";
  row.innerHTML = `
    <img src="${iconUrl}" 
        style="width:32px;height:32px;opacity:.9;border-radius:6px;" />
    <span class="file-name">${file.name}</span>
    <div class="progress"></div>
  `;
  listFiles.appendChild(row);

    if (!isValid) {
      invalidFiles.push(file.name);
      row.classList.add("invalid-file");
      setTimeout(() => {
        row.style.transition = "opacity .5s ease";
        row.style.opacity = "0";
        setTimeout(() => row.remove(), 400);
      }, 800);
    } else {
      validFiles.push(file);
    }
  });

  if (invalidFiles.length) {
    showToast(`⚠️ ${invalidFiles.length} ignorado(s): ${invalidFiles.join(", ")}`, "warning");
  }

  if (!validFiles.length) {
    btnUpload.classList.remove("active");
    showToast("Nenhum arquivo válido para upload.", "error");
    return;
  }

  btnUpload.classList.add("active");

  // substitui o input pelos válidos
  const dt = new DataTransfer();
  validFiles.forEach((f) => dt.items.add(f));
  inputFile.files = dt.files;
});

/***********************
 * CONVERSÃO P/ WEBP (300px lado maior)
 ***********************/
async function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 300;
        let { width, height } = img;
        if (width >= height) {
          height = Math.round((height / width) * maxSide);
          width = maxSide;
        } else {
          width = Math.round((width / height) * maxSide);
          height = maxSide;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject("Erro na conversão");
            const baseName = file.name.split(".")[0];
            const webp = new File([blob], `${baseName}.webp`, { type: "image/webp" });
            resolve(webp);
          },
          "image/webp",
          0.85
        );
      };
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/***********************
 * UPLOAD (paralelo + barra global do modal)
 ***********************/
async function uploadOne(webpFile) {
  const formData = new FormData();
  formData.append("file", webpFile);
  const res = await fetch(ENDPOINTS.upload, { method: "POST", body: formData });
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
          .then((r) => (results[i] = { ok: true, value: r }))
          .catch((e) => (results[i] = { ok: false, error: e }))
          .finally(() => {
            inFlight--; done++;
            onProgress?.(done, items.length);
            next();
          });
      }
    }
    next();
  });
}

btnUpload.addEventListener("click", async () => {
  if (!inputFile.files.length) return showToast("Nenhum arquivo selecionado", "warning");

  const allFiles = Array.from(inputFile.files);
  const validFiles = allFiles.filter((f) => /^\d+$/.test(f.name.split(".")[0]));
  if (!validFiles.length) {
    showToast("Nenhum arquivo válido para enviar.", "error");
    return;
  }

  showLoading(`⬆️ Preparando ${validFiles.length} arquivo(s)...`);
  setProgress(5);
  btnUpload.disabled = true;

  // 1) Converter
  const webps = [];
  for (let i = 0; i < validFiles.length; i++) {
    loadingText.textContent = `🧪 Convertendo ${i + 1} / ${validFiles.length}`;
    const w = await processImage(validFiles[i]);
    webps.push(w);
    setProgress(5 + (i / validFiles.length) * 20);
  }

  // 2) Upload paralelo
  let lastPct = 25;
  const results = await runInBatches(
    webps,
    uploadOne,
    UPLOAD_CONCURRENCY,
    (done, total) => {
      const pct = 25 + Math.floor((done / total) * 60);
      if (pct > lastPct) {
        lastPct = pct;
        setProgress(pct);
        loadingText.textContent = `📤 Enviando ${done} / ${total}...`;
      }
    }
  );

  // 3) Atualizar galeria (paginação real, sem modal)
  const sent = results.filter((r) => r?.ok).length;
  const failed = results.filter((r) => !r?.ok).length;

  loadingText.textContent = "🔄 Atualizando galeria...";
  setProgress(92);
  try {
    await fetchAllPagesAndRender();
  } catch (e) {
    console.warn("Falha ao atualizar após upload", e);
  }

  hideLoading("✅ Envio finalizado!");
  showToast(`✅ ${sent} enviado(s) | ❌ ${failed} com erro`, failed ? "warning" : "success");

  btnUpload.disabled = false;
  btnUpload.classList.remove("active");
  listFiles.innerHTML = "";
  inputFile.value = "";
});

/***********************
 * EXCLUSÃO
 ***********************/
confirmDelete.addEventListener("click", async () => {
  if (!pendingDelete) return;
  confirmModal.classList.add("hidden");
  try {
    showLoading(`🗑️ Excluindo ${pendingDelete.filename}...`);
    const res = await fetch(ENDPOINTS.delete, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: pendingDelete.filename }),
    });
    const result = await res.json();
    if (res.ok) {
      state.items = state.items.filter((x) => x.name !== pendingDelete.filename);
      writeCache(state.items);
      resetAndRenderAll();
      showToast(result.message);
    } else showToast(result.error || "Erro ao excluir", "error");
  } catch {
    showToast("Erro na exclusão", "error");
  } finally {
    pendingDelete = null;
    hideLoading();
  }
});
cancelDelete.addEventListener("click", () => {
  confirmModal.classList.add("hidden");
  pendingDelete = null;
});

/***********************
 * DRAG & DROP
 ***********************/
triggerFile?.addEventListener("click", (e) => (e.preventDefault(), inputFile.click()));
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("active");
});
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("active"));
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("active");
  inputFile.files = e.dataTransfer.files;
  inputFile.dispatchEvent(new Event("change"));
});

/***********************
 * INICIALIZAÇÃO
 ***********************/
window.addEventListener("DOMContentLoaded", loadGallery);
