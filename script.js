/***********************
 * CONFIGURAÇÕES
 ***********************/
const API_BASE = "https://fotos-lt35.onrender.com"; // troque se necessário
const ENDPOINTS = {
  list: `${API_BASE}/list_files`,
  upload: `${API_BASE}/upload`,
  delete: `${API_BASE}/delete`,
};

// Tamanho do lote do scroll infinito
const BATCH_SIZE = 500;

// Conexões simultâneas de upload
const UPLOAD_CONCURRENCY = 5;

// Cache local (chave e validade em ms)
const CACHE_KEY = "galleryIndex.v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

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
  // lista completa vinda do servidor (ou cache)
  items: [], // [{name, url}]
  // lista filtrada (busca)
  filtered: [],
  // quantos itens do filtered já estão renderizados
  renderedCount: 0,
  // se já estamos carregando/atualizando
  loading: false,
  // se estamos buscando (aplica debounce)
  searchTerm: "",
};

/***********************
 * UI / MODAL
 ***********************/
function showLoading(msg = "⏳ Processando...") {
  loadingModal.classList.remove("hidden");
  loadingText.textContent = msg;
  progressInner.style.width = "0%";
}
function setProgress(pct) {
  progressInner.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideLoading(msg = "✅ Concluído!") {
  loadingText.textContent = msg;
  setProgress(100);
  setTimeout(() => loadingModal.classList.add("hidden"), 900);
}

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
    // se der quota excedida, ignoramos
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
  if (!q) {
    state.filtered = state.items;
    return;
  }
  state.filtered = state.items.filter((it) =>
    it.name.toLowerCase().includes(q)
  );
}
function renderNextBatch() {
  // Renderiza mais BATCH_SIZE itens (ou até o fim)
  const start = state.renderedCount;
  const end = Math.min(start + BATCH_SIZE, state.filtered.length);
  if (start >= end) return;

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const f = state.filtered[i];
    const li = document.createElement("li");
    li.className = "file-item";
    // Sem thumb de imagem para não pesar (você pediu apenas nome + lixeira)
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
function isNearBottom(element, threshold = 120) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
}
fileList.addEventListener("scroll", () => {
  if (isNearBottom(fileList)) {
    renderNextBatch();
  }
});

/***********************
 * BUSCA (com debounce)
 ***********************/
const onSearch = debounce(() => {
  state.searchTerm = searchInput.value || "";
  resetAndRenderAll();
}, 300);
searchInput.addEventListener("input", onSearch);

/***********************
 * LISTAGEM (com atualização parcial)
 * - Passo 1: carrega do cache imediatamente (se houver).
 * - Passo 2: busca no servidor e faz "merge" apenas do que mudou.
 ***********************/
async function fetchServerList() {
  const res = await fetch(ENDPOINTS.list);
  if (!res.ok) throw new Error("Falha ao listar no servidor");
  return res.json(); // [{name,url}]
}
function mergeLists(oldList, newList) {
  // cria sets pelos nomes
  const oldMap = new Map(oldList.map((x) => [x.name, x]));
  const newMap = new Map(newList.map((x) => [x.name, x]));

  // adiciona novos
  const merged = [...oldList];
  for (const [name, item] of newMap) {
    if (!oldMap.has(name)) merged.push(item);
  }
  // remove que não existem mais
  const result = merged.filter((x) => newMap.has(x.name));

  // ordena por nome (padrão atual)
  result.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return result;
}

async function loadGallery() {
  // 1) tenta cache
  const cached = readCache();
  if (cached && cached.length) {
    state.items = cached;
    resetAndRenderAll();
  } else {
    // mostra algo mínimo
    fileList.innerHTML = "<li style='padding:10px;color:#888'>Carregando...</li>";
  }

  // 2) atualiza com servidor (e re-renderiza apenas se mudou)
  try {
    state.loading = true;
    showLoading("📂 Atualizando galeria...");
    const serverItems = await fetchServerList();

    if (!Array.isArray(serverItems)) throw new Error("Formato inválido");
    // ordena e salva
    serverItems.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );

    // Se não tinha cache ou mudou, mergeia e atualiza UI
    if (!cached || JSON.stringify(cached.map((i) => i.name)) !== JSON.stringify(serverItems.map((i) => i.name))) {
      state.items = cached ? mergeLists(cached, serverItems) : serverItems;
      writeCache(state.items);
      resetAndRenderAll();
    }
    hideLoading("✅ Galeria atualizada!");
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar galeria", "error");
    hideLoading("❌ Falha");
  } finally {
    state.loading = false;
  }
}

/***********************
 * PREVIEW DOS ARQUIVOS (VALIDAÇÃO VISUAL + REGRA NUMÉRICA)
 ***********************/
inputFile.addEventListener("change", () => {
  listFiles.innerHTML = "";
  if (!inputFile.files.length) return;

  const validFiles = [];
  const invalidFiles = [];

  Array.from(inputFile.files).forEach((file) => {
    const nameWithoutExt = file.name.split(".")[0];
    const isValid = /^\d+$/.test(nameWithoutExt);

    const div = document.createElement("div");
    div.className = "file";
    div.innerHTML = `
      <img src="https://cdn-icons-png.flaticon.com/512/337/337946.png" style="width:32px;height:32px;opacity:0.8;" />
      
      <span class="file-name">${file.name}</span>
      <div class="progress"></div>
    `;
    listFiles.appendChild(div);

    if (!isValid) {
      invalidFiles.push(file.name);
      div.classList.add("invalid-file");
      setTimeout(() => {
        div.style.transition = "opacity 0.5s ease";
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 400);
      }, 800);
    } else {
      validFiles.push(file);
    }
  });

  if (invalidFiles.length > 0) {
    showToast(
      `⚠️ ${invalidFiles.length} arquivo(s) ignorado(s): ${invalidFiles.join(", ")}`,
      "warning"
    );
  }

  if (!validFiles.length) {
    btnUpload.classList.remove("active");
    showToast("Nenhum arquivo válido para upload.", "error");
    return;
  }

  btnUpload.classList.add("active");

  // substitui o input apenas pelos válidos
  const dt = new DataTransfer();
  validFiles.forEach((f) => dt.items.add(f));
  inputFile.files = dt.files;
});

/***********************
 * REDIMENSIONAR E CONVERTER PARA WEBP (lado maior = 300px)
 ***********************/
async function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const maxSide = 300;
        let { width, height } = img;
        if (width >= height) {
          if (width !== maxSide) {
            height = Math.round((height / width) * maxSide);
            width = maxSide;
          }
        } else {
          if (height !== maxSide) {
            width = Math.round((width / height) * maxSide);
            height = maxSide;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) reject("Erro na conversão");
            else {
              const baseName = file.name.split(".")[0];
              const webpFile = new File([blob], `${baseName}.webp`, {
                type: "image/webp",
              });
              resolve(webpFile);
            }
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
 * HELPERS DE UPLOAD PARALELO
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
  let inFlight = 0;
  let idx = 0;
  let done = 0;
  return new Promise((resolve) => {
    const results = [];
    function next() {
      if (done === items.length) return resolve(results);
      while (inFlight < concurrency && idx < items.length) {
        const currentIndex = idx++;
        inFlight++;
        worker(items[currentIndex])
          .then((r) => (results[currentIndex] = { ok: true, value: r }))
          .catch((e) => (results[currentIndex] = { ok: false, error: e }))
          .finally(() => {
            inFlight--;
            done++;
            onProgress?.(done, items.length);
            next();
          });
      }
    }
    next();
  });
}

/***********************
 * UPLOAD (paralelo + progress)
 ***********************/
btnUpload.addEventListener("click", async () => {
  if (!inputFile.files.length)
    return showToast("Nenhum arquivo selecionado", "warning");

  // coleta só válidos (já filtrado no change, mas garantimos)
  const allFiles = Array.from(inputFile.files);
  const validFiles = allFiles.filter((f) => /^\d+$/.test(f.name.split(".")[0]));
  if (!validFiles.length) {
    showToast("Nenhum arquivo válido para enviar.", "error");
    return;
  }

  showLoading(`⬆️ Preparando ${validFiles.length} arquivo(s)...`);
  setProgress(5);
  btnUpload.disabled = true;

  // 1) Converte todos para webp (em sequência para não explodir memória)
  const webps = [];
  for (let i = 0; i < validFiles.length; i++) {
    loadingText.textContent = `🧪 Convertendo ${i + 1} / ${validFiles.length}`;
    const w = await processImage(validFiles[i]);
    webps.push(w);
    setProgress(5 + (i / validFiles.length) * 20); // até 25%
  }

  // 2) Envia em paralelo (batches)
  let lastPct = 25;
  const results = await runInBatches(
    webps,
    uploadOne,
    UPLOAD_CONCURRENCY,
    (done, total) => {
      const pct = 25 + Math.floor((done / total) * 60); // 25% → 85%
      if (pct > lastPct) {
        lastPct = pct;
        setProgress(pct);
        loadingText.textContent = `📤 Enviando ${done} / ${total}...`;
      }
    }
  );

  // 3) Resumo
  const sent = results.filter((r) => r?.ok).length;
  const failed = results.filter((r) => !r?.ok).length;

  // 4) Atualiza lista de forma parcial (busca de novo e merge)
  loadingText.textContent = "🔄 Atualizando galeria...";
  setProgress(92);
  try {
    const fresh = await fetchServerList();
    fresh.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    state.items = mergeLists(state.items, fresh);
    writeCache(state.items);
    resetAndRenderAll();
  } catch (e) {
    console.warn("Falha ao atualizar após upload", e);
  }

  hideLoading("✅ Envio finalizado!");
  const summary = `✅ ${sent} enviado(s) | ❌ ${failed} com erro`;
  showToast(summary, failed ? "warning" : "success");

  btnUpload.disabled = false;
  btnUpload.classList.remove("active");
  listFiles.innerHTML = "";
  inputFile.value = "";
});

/***********************
 * EXCLUSÃO CONFIRMADA
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
      // Remove do estado e cache
      state.items = state.items.filter((x) => x.name !== pendingDelete.filename);
      writeCache(state.items);
      // Re-render filtrado
      resetAndRenderAll();
      showToast(result.message);
    } else showToast(result.error || "Erro ao excluir", "error");
  } catch (err) {
    console.error(err);
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
