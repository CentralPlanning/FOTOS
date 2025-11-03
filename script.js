/***********************
 * CONFIGURAÇÕES
 ***********************/
const API_BASE = "http://127.0.0.1:5000";
const ENDPOINTS = {
  list: `${API_BASE}/list_files`,
  upload: `${API_BASE}/upload`,
  delete: `${API_BASE}/delete`,
};

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
 * UI / MODAL
 ***********************/
function showLoading(msg = "⏳ Processando...") {
  loadingModal.classList.remove("hidden");
  loadingText.textContent = msg;
  progressInner.style.width = "0%";
}
function setProgress(pct) {
  progressInner.style.width = `${pct}%`;
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
 * REDIMENSIONAR E CONVERTER PARA WEBP
 ***********************/
async function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const maxW = 300;
        const scale = maxW / img.width;
        const newW = Math.min(maxW, img.width);
        const newH = img.height * scale;

        canvas.width = newW;
        canvas.height = newH;
        ctx.drawImage(img, 0, 0, newW, newH);

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
 * UPLOAD COM VALIDAÇÃO E CONTADOR
 ***********************/
btnUpload.addEventListener("click", async () => {
  if (!inputFile.files.length)
    return showToast("Nenhum arquivo selecionado", "warning");

  const allFiles = Array.from(inputFile.files);
  const validFiles = [];
  const invalidFiles = [];

  for (const file of allFiles) {
    const nameWithoutExt = file.name.split(".")[0];
    if (/^\d+$/.test(nameWithoutExt)) validFiles.push(file);
    else invalidFiles.push(file.name);
  }

  if (invalidFiles.length > 0) {
    showToast(
      `⚠️ ${invalidFiles.length} arquivo(s) ignorado(s): ${invalidFiles.join(", ")}`,
      "warning"
    );
  }

  if (!validFiles.length) {
    showToast("Nenhum arquivo válido para enviar.", "error");
    return;
  }

  showLoading(`⬆️ Enviando ${validFiles.length} arquivo(s)...`);
  let sent = 0;
  let failed = 0;

  for (const [i, file] of validFiles.entries()) {
    try {
      loadingText.textContent = `📤 Enviando ${i + 1} de ${validFiles.length}...`;
      setProgress(((i + 1) / validFiles.length) * 80);

      const webpFile = await processImage(file);
      const formData = new FormData();
      formData.append("file", webpFile);

      const res = await fetch(ENDPOINTS.upload, { method: "POST", body: formData });
      const result = await res.json();

      if (res.ok) {
        sent++;
      } else {
        failed++;
        console.warn("Erro upload:", result);
      }
    } catch (err) {
      console.error(err);
      failed++;
    }
  }

  hideLoading(`✅ Envio finalizado!`);
  const summary = `✅ ${sent} enviado(s) | ⚠️ ${invalidFiles.length} ignorado(s) | ❌ ${failed} com erro`;
  showToast(summary, failed ? "warning" : "success");

  await loadGallery();
  inputFile.value = "";
  btnUpload.classList.remove("active");
  listFiles.innerHTML = "";
});

/***********************
 * GALERIA
 ***********************/
async function loadGallery() {
  try {
    showLoading("📂 Carregando galeria...");
    const res = await fetch(ENDPOINTS.list);
    const items = await res.json();
    fileList.innerHTML = "";

    if (!items.length) {
      fileList.innerHTML =
        "<li style='padding:10px;color:#888'>Nenhum arquivo encontrado.</li>";
      return hideLoading("🟡 Galeria vazia");
    }

    for (const f of items) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.innerHTML = `
        <span class="file-name">${f.name}</span>
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
      fileList.appendChild(li);
    }

    hideLoading("✅ Galeria atualizada!");
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar galeria", "error");
    hideLoading("❌ Falha");
  }
}

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
      pendingDelete.element.remove();
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
 * BUSCA LOCAL
 ***********************/
searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase();
  document.querySelectorAll(".file-item").forEach((li) => {
    li.style.display = li.textContent.toLowerCase().includes(q)
      ? "flex"
      : "none";
  });
});

/***********************
 * DRAG & DROP
 ***********************/
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
