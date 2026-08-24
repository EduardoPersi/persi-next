(() => {
  const config = window.persiCatalogProgress;
  const modal = document.getElementById("persi-progress-modal");
  if (!config || !modal) return;

  let runId = Number(config.runId || 0);
  let timer = null;
  let kickInFlight = false, lastProcessed = -1, stagnantSince = Date.now();
  const el = (id) => document.getElementById(id);
  const labels = {
    UPDATED: "Atualizados", WOULD_UPDATE: "Seriam atualizados", ALREADY_SYNCED: "Já sincronizados",
    OLIST_NO_GTIN: "Sem GTIN no Olist", GTIN_CONFLICT: "Conflitos", API_ERROR: "Erros",
    OLIST_NOT_FOUND: "Não encontrados", INVALID_GTIN: "GTIN inválido", NO_SKU: "Sem SKU",
    SKIPPED: "Ignorados", AMBIGUOUS_MATCH: "Correspondências ambíguas",
    ATTRIBUTE_SKIPPED: "Atributos ignorados", ATTRIBUTE_DISCOVERED: "Atributos descobertos",
    ATTRIBUTE_WOULD_UPDATE: "Atributos seriam atualizados", ATTRIBUTE_ALREADY_SYNCED: "Atributos já existentes",
    ATTRIBUTE_CONFLICT: "Conflitos de atributos", ATTRIBUTE_MAPPING_REQUIRED: "Mapeamentos necessários", ATTRIBUTE_REVIEW_REQUIRED: "Revisões necessárias"
	, ATTRIBUTE_CANDIDATE: "Novos candidatos", ATTRIBUTE_NO_VALUE: "Sem valor encontrado", ATTRIBUTE_UNSUPPORTED_CONTEXT: "Contexto não suportado"
  };
  const stageLabels = {QUEUE_PREPARING:"Preparando fila", QUEUE_READY:"Fila preparada", OLIST_LOOKUP:"Consultando o Olist", GTIN_VALIDATING:"Validando GTIN", GTIN_UPDATED:"GTIN atualizado", GTIN_WOULD_UPDATE:"GTIN seria atualizado", ALREADY_SYNCED:"Já sincronizado", OLIST_NO_GTIN:"Sem GTIN no Olist", GTIN_CONFLICT:"Conflito de GTIN", API_ERROR:"Erro na API", ATTRIBUTE_DISCOVERY:"Descobrindo atributos", PARTIAL_SUCCESS:"Concluído parcialmente", COMPLETED:"Concluído", CANCELLED:"Cancelado", PREPARATION_FAILED:"Falha na preparação"};

  function open(id) {
    runId = Number(id || runId); if (!runId) return;
    modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
    poll();
  }
  function close() {
    modal.hidden = true; modal.setAttribute("aria-hidden", "true"); document.body.style.overflow = "";
    if (timer) window.clearTimeout(timer); timer = null;
  }
  function render(data) {
	const total = Number(data.total || 0), requested = Number(data.requested || total), processed = Number(data.processed || 0);
    if (processed !== lastProcessed) { lastProcessed = processed; stagnantSince = Date.now(); }
    const percent = total > 0 ? Math.min(100, Math.round(processed * 100 / total)) : 0;
    el("persi-progress-bar").style.width = `${percent}%`;
    el("persi-progress-percent").textContent = total ? `${percent}%` : "Preparando fila...";
	el("persi-progress-count").textContent = total ? `${processed} de ${total} itens disponíveis${requested > total ? ` (${requested} solicitados)` : ""}` : (requested ? `Nenhum item disponível para os ${requested} solicitados` : "");
    el("persi-current-product").textContent = data.productName || "—";
    el("persi-current-sku").textContent = data.sku || "—";
    el("persi-current-message").textContent = data.message || data.stage || "Preparando produtos...";
		el("persi-current-stage").textContent = stageLabels[data.stage] || data.stage || "Preparando fila";
    el("persi-progress-heading").textContent = data.status === "completed" ? "Processamento concluído" : (data.status === "partial_success" ? "Processamento concluído parcialmente" : (data.status === "cancelled" ? "Processamento cancelado" : "Processando catálogo"));
    const dry = data.mode === "dry-run";
    const mode = el("persi-progress-mode"); mode.classList.toggle("is-sync", !dry);
    mode.textContent = dry ? "MODO DE SIMULAÇÃO — Nenhum produto será alterado." : "SINCRONIZAÇÃO REAL — Alterações aprovadas poderão ser gravadas.";
    const counters = el("persi-progress-counters"); counters.replaceChildren();
    Object.entries(data.counters || {}).forEach(([status, value]) => {
      const box = document.createElement("div"); box.className = "persi-counter";
      const label = dry && status === "UPDATED" ? "Seriam atualizados" : (labels[status] || status);
      box.textContent = `${label}: ${Number(value || 0)}`; counters.appendChild(box);
    });
    if (data.startedAt) {
      const start = Date.parse(data.startedAt.replace(" ", "T") + "Z");
      const end = data.finishedAt ? Date.parse(data.finishedAt.replace(" ", "T") + "Z") : Date.now();
      const seconds = Math.max(0, Math.round((end - start) / 1000));
      el("persi-progress-time").textContent = `Tempo: ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		if ( processed >= 5 && seconds > 0 ) {
			const rate = processed / seconds, remaining = Math.max(0, total - processed), eta = Math.round(remaining / Math.max(rate, 0.001));
			el("persi-progress-rate").textContent = `Velocidade: ${rate.toLocaleString("pt-BR", {maximumFractionDigits: 2})} produto(s)/s · Tempo restante aproximado: ~${eta}s`;
		} else { el("persi-progress-rate").textContent = "A estimativa aparecerá após pelo menos 5 itens."; }
    }
		if (data.status === "failed" && data.failureMessage) el("persi-current-message").textContent = `${data.failureMessage} (${data.failureStage || ""}/${data.failureCode || ""})`;
    const terminal = data.status === "completed" || data.status === "partial_success" || data.status === "failed" || data.status === "cancelled";
    const cancelButton = el("persi-cancel-progress"); if (cancelButton) cancelButton.hidden = terminal;
    if (!terminal && ((data.status === "pending" && data.stage === "QUEUE_READY") || Date.now() - stagnantSince > 8000)) kickWorker();
    return terminal;
  }
  async function kickWorker() {
    if (kickInFlight || !runId || modal.hidden) return;
    kickInFlight = true;
    const body = new URLSearchParams({action:"persi_catalog_kick_worker", nonce:config.nonce, run_id:String(runId)});
    try {
      await fetch(config.ajaxUrl, {method:"POST", credentials:"same-origin", body, cache:"no-store"});
      stagnantSince = Date.now();
      if (timer) window.clearTimeout(timer); timer = null;
      if (!modal.hidden) poll();
    } catch (_) {
      // O Action Scheduler permanece como fallback mesmo se o acionamento imediato falhar.
    } finally { kickInFlight = false; }
  }
  async function poll() {
    if (!runId || modal.hidden) return;
    const url = new URL(config.ajaxUrl); url.searchParams.set("action", "persi_catalog_progress"); url.searchParams.set("nonce", config.nonce); url.searchParams.set("run_id", String(runId));
    try {
      const response = await fetch(url, {credentials: "same-origin", cache: "no-store"});
      const json = await response.json();
      if (!json.success) throw new Error(json.data?.message || "Falha ao consultar progresso.");
		if (!render(json.data)) timer = window.setTimeout(poll, json.data.status === "pending" ? 3000 : Number(config.pollInterval || 2000));
    } catch (error) {
      el("persi-current-message").textContent = error.message; timer = window.setTimeout(poll, 5000);
    }
  }
  document.querySelectorAll(".persi-open-progress").forEach((button) => button.addEventListener("click", () => open(button.dataset.runId)));
  el("persi-close-progress")?.addEventListener("click", close);
  el("persi-cancel-progress")?.addEventListener("click", async () => {
    if (!runId || !window.confirm("Cancelar esta sincronização? Itens já concluídos não serão desfeitos.")) return;
    const button = el("persi-cancel-progress"); button.disabled = true; button.textContent = "Cancelando...";
    const body = new URLSearchParams({action:"persi_catalog_cancel", nonce:config.cancelNonce, run_id:String(runId)});
    try {
      const response = await fetch(config.ajaxUrl, {method:"POST", credentials:"same-origin", body}); const json = await response.json();
      if (!json.success) throw new Error(json.data?.message || "Não foi possível cancelar.");
      el("persi-progress-heading").textContent = "Processamento cancelado"; el("persi-current-stage").textContent = "CANCELLED"; el("persi-current-message").textContent = json.data.message; button.hidden = true;
      if (timer) window.clearTimeout(timer); timer = null;
    } catch (error) { window.alert(error.message); button.disabled = false; button.textContent = "Cancelar sincronização"; }
  });
  if (runId) open(runId);

  const modeSelect = el("persi-mode"), syncConfirmation = el("persi-sync-confirmation"), confirmSync = el("persi-confirm-sync");
  function updateConfirmation() { const sync = modeSelect?.value === "sync"; if (syncConfirmation) syncConfirmation.hidden = !sync; if (!sync && confirmSync) confirmSync.checked = false; const attributes = document.querySelector('input[name="modules[]"][value="attributes"]'); if (attributes) { if (sync) attributes.checked = false; attributes.disabled = sync; attributes.closest("label").title = sync ? "Atributos funciona somente em Simulação." : ""; } }
  modeSelect?.addEventListener("change", updateConfirmation); updateConfirmation();

  const manualField = el("persi-manual-field"), query = el("persi-product-query"), resultsBox = el("persi-search-results");
  const selectedBox = el("persi-selected-products"), inputsBox = el("persi-selected-inputs"), searchStatus = el("persi-search-status");
  const selected = new Map(), currentResults = new Map(); let searchTimer = null, requestController = null;
  const text = (value) => value || "—";
  function productCard(product, removable = false) {
    const row = document.createElement("div"); row.className = "persi-product-row";
    const info = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = product.name; info.append(title);
    const moduleNames = [...document.querySelectorAll('input[name="modules[]"]:checked')].map((input) => input.value === "gtin" ? "GTIN" : "Atributos").join(" + ");
    const meta = document.createElement("small"); meta.textContent = `SKU: ${text(product.sku)} · ${product.type} · GTIN: ${text(product.gtin)} · Marca: ${text(product.brand)}${removable ? ` · Módulos: ${moduleNames || "—"}` : ""}`; info.append(meta);
    const button = document.createElement("button"); button.type = "button"; button.className = "button"; button.textContent = removable ? "Remover" : (selected.has(product.id) ? "Selecionado" : "Selecionar"); button.disabled = !removable && selected.has(product.id);
    button.addEventListener("click", () => { removable ? selected.delete(product.id) : selected.set(product.id, product); renderSelected(); renderResults(); });
    row.append(info, button); return row;
  }
  function renderResults() { resultsBox?.replaceChildren(...[...currentResults.values()].map((product) => productCard(product))); el("persi-select-results").hidden = !currentResults.size; }
  function renderSelected() {
    selectedBox?.replaceChildren(...[...selected.values()].map((product) => productCard(product, true)));
    inputsBox?.replaceChildren(...[...selected.keys()].map((id) => { const input = document.createElement("input"); input.type = "hidden"; input.name = "selected_product_ids[]"; input.value = String(id); return input; }));
    el("persi-selected-count").textContent = `${selected.size} produto${selected.size === 1 ? "" : "s"} selecionado${selected.size === 1 ? "" : "s"}`;
    el("persi-review-selection").disabled = !selected.size; el("persi-target-preview").hidden = true;
  }
  async function search() {
    const term = query?.value.trim() || ""; currentResults.clear(); renderResults();
    if (term.length < 2) { searchStatus.textContent = "Digite ao menos 2 caracteres."; return; }
    requestController?.abort(); requestController = new AbortController(); searchStatus.textContent = "Pesquisando catálogo local...";
    const url = new URL(config.ajaxUrl); url.searchParams.set("action", "persi_catalog_product_search"); url.searchParams.set("nonce", config.selectionNonce); url.searchParams.set("query", term); url.searchParams.set("category_id", el("persi-product-category")?.value || ""); url.searchParams.set("brand_id", el("persi-product-brand")?.value || "");
    try { const response = await fetch(url, {credentials:"same-origin", cache:"no-store", signal:requestController.signal}); const json = await response.json(); if (!json.success) throw new Error(json.data?.message || "Falha na pesquisa."); (json.data.results || []).forEach((product) => currentResults.set(Number(product.id), product)); searchStatus.textContent = currentResults.size ? `${currentResults.size} resultado(s).` : "Nenhum produto encontrado."; renderResults(); } catch (error) { if (error.name !== "AbortError") searchStatus.textContent = error.message; }
  }
  document.querySelectorAll('input[name="selection_mode"]').forEach((radio) => radio.addEventListener("change", () => { const manual = radio.checked && radio.value === "manual"; if (manual) { manualField.hidden = false; document.querySelectorAll(".persi-automatic-field").forEach((row) => row.hidden = true); } else if (radio.checked) { manualField.hidden = true; document.querySelectorAll(".persi-automatic-field").forEach((row) => row.hidden = false); } }));
  query?.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(search, 350); });
  el("persi-product-category")?.addEventListener("change", search); el("persi-product-brand")?.addEventListener("change", search);
  el("persi-select-results")?.addEventListener("click", () => { currentResults.forEach((product, id) => selected.set(id, product)); renderSelected(); renderResults(); });
  el("persi-clear-selection")?.addEventListener("click", () => { selected.clear(); renderSelected(); renderResults(); });
  document.querySelectorAll('input[name="modules[]"]').forEach((input) => input.addEventListener("change", renderSelected));
  el("persi-review-selection")?.addEventListener("click", async () => {
    const body = new URLSearchParams({action:"persi_catalog_selection_preview", nonce:config.selectionNonce}); selected.forEach((_, id) => body.append("ids[]", String(id))); document.querySelectorAll('input[name="modules[]"]:checked').forEach((input) => body.append("modules[]", input.value));
    const preview = el("persi-target-preview"); preview.hidden = false; preview.querySelector("p").textContent = "Validando seleção...";
    try { const response = await fetch(config.ajaxUrl, {method:"POST", credentials:"same-origin", body}); const json = await response.json(); if (!json.success) throw new Error(json.data?.message || "Seleção inválida."); preview.querySelector("p").textContent = `${selected.size} produto(s) selecionado(s). Fila real: ${json.data.queueTotal}. GTIN: ${json.data.gtinTargets} SKU(s)/variação(ões). Atributos: ${json.data.attributeTargets} produto(s) pai.`; selectedBox.classList.add("is-reviewing"); } catch (error) { preview.querySelector("p").textContent = error.message; }
  });
  document.querySelector('form[action*="admin-post.php"]')?.addEventListener("submit", (event) => { if (document.querySelector('input[name="selection_mode"]:checked')?.value === "manual" && !selected.size) { event.preventDefault(); window.alert("Selecione pelo menos um produto."); } });
})();
