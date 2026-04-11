const API = window.API_BASE_URL || "/api";

const byId = (id) => document.getElementById(id);

let uploadedPhotoUrl = null;
let currentCoords = null;
let latestMercadoPagoLink = null;
let currentAccessTab = "client";
let currentUser = null;

const PRICE_BY_DURATION = {
  15: 20,
  30: 35,
  45: 50,
  60: 65
};

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  byId(screenId)?.classList.add("active");
}

function updateHeaderState() {
  const logoutBtn = byId("logoutBtn");
  if (!logoutBtn) return;
  logoutBtn.classList.toggle("hidden", !currentUser);
}

function goToCurrentHome() {
  if (!currentUser) {
    showScreen("landingScreen");
    return;
  }
  if (currentUser.role === "admin") {
    showScreen("adminDashboard");
    return;
  }
  if (currentUser.role === "walker") {
    showScreen("walkerDashboard");
    return;
  }
  showScreen("clientDashboard");
}

function renderSession(user) {
  currentUser = user || null;

  if (!user) {
    updateHeaderState();
    return;
  }

  if (user.role === "admin") {
    showScreen("adminDashboard");
    if (byId("adminSessionInfo")) {
      byId("adminSessionInfo").textContent = `${user.full_name || "Admin"} conectado`;
    }
    loadAdminDashboard();
  } else if (user.role === "walker") {
    showScreen("walkerDashboard");
    if (byId("walkerSessionInfo")) {
      byId("walkerSessionInfo").textContent = `${user.full_name || "Passeador"} conectado`;
    }
    loadRequests();
  } else {
    showScreen("clientDashboard");
    if (byId("clientSessionInfo")) {
      byId("clientSessionInfo").textContent = `${user.full_name || "Cliente"} conectado`;
    }
    fillClientFieldsFromSession();
    syncEstimatedPrice();
    loadRequests();
  }

  updateHeaderState();
}

function fillClientFieldsFromSession() {
  if (!currentUser || currentUser.role !== "client") return;
  const petOwner = byId("pet_owner_id");
  if (petOwner) petOwner.value = currentUser.id ?? "";
}

function logout() {
  localStorage.removeItem("session_user");
  currentUser = null;
  currentAccessTab = "client";
  latestMercadoPagoLink = null;
  uploadedPhotoUrl = null;
  showScreen("landingScreen");
  updateHeaderState();
  updatePaymentBoxDefault();
}

function buildMapUrl(address) {
  const q = encodeURIComponent(address);
  return `https://www.openstreetmap.org/export/embed.html?search=${q}&marker=1&query=${q}`;
}

function buildCoordsMapUrl(lat, lng) {
  const delta = 0.01;
  const left = lng - delta;
  const right = lng + delta;
  const top = lat + delta;
  const bottom = lat - delta;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function applyDetectedLocation(lat, lng) {
  currentCoords = { lat, lng };
  const label = `Localização atual (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

  ["address", "mapAddress", "pickup_address"].forEach((id) => {
    const el = byId(id);
    if (el) el.value = label;
  });

  const mapFrame = byId("mapFrame");
  if (mapFrame) {
    mapFrame.src = buildCoordsMapUrl(lat, lng);
  }
}

function tryAutoLocate() {
  if (!navigator.geolocation) {
    loadMap();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      applyDetectedLocation(position.coords.latitude, position.coords.longitude);
    },
    () => {
      loadMap();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

function setPhotoStatus(message) {
  const el = byId("photoUploadStatus");
  if (el) el.textContent = message;
}

function setPhotoPreview(src) {
  const wrap = byId("photoPreviewWrap");
  const img = byId("photoPreview");
  if (!wrap || !img) return;

  if (!src) {
    img.removeAttribute("src");
    wrap.classList.add("hidden");
    return;
  }

  img.src = src;
  wrap.classList.remove("hidden");
}

function getAbsoluteFileUrl(relativeUrl) {
  if (!relativeUrl) return null;
  if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl;
  return `${window.location.origin}${relativeUrl}`;
}

async function uploadProfilePhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem válido.");
  }

  const formData = new FormData();
  formData.append("file", file);

  setPhotoStatus(`Enviando foto: ${file.name}...`);

  const res = await fetch(`${API}/uploads/profile-photo`, {
    method: "POST",
    body: formData
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Falha ao enviar a foto.");
  }

  uploadedPhotoUrl = data.file_url;

  const profilePhotoInput = byId("profile_photo");
  if (profilePhotoInput) {
    profilePhotoInput.value = getAbsoluteFileUrl(data.file_url);
  }

  setPhotoPreview(getAbsoluteFileUrl(data.file_url));
  setPhotoStatus(`Foto carregada com sucesso: ${file.name}`);
  return data.file_url;
}

async function handlePhotoFile(file) {
  try {
    await uploadProfilePhoto(file);
  } catch (err) {
    setPhotoStatus(err.message);
    alert(err.message);
  }
}

function loadMap() {
  const mapAddress = byId("mapAddress");
  const mapFrame = byId("mapFrame");
  if (!mapAddress || !mapFrame) return;

  const address = mapAddress.value.trim();

  if (currentCoords && (!address || address === "localhost" || address.startsWith("Localização atual"))) {
    mapFrame.src = buildCoordsMapUrl(currentCoords.lat, currentCoords.lng);
    return;
  }

  if (!address) return;
  mapFrame.src = buildMapUrl(address);
}

function syncEstimatedPrice() {
  const durationField = byId("duration_minutes");
  const priceField = byId("price");
  if (!durationField || !priceField) return;

  const duration = Number(durationField.value || 30);
  const price = PRICE_BY_DURATION[duration] ?? 35;
  priceField.value = price;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || data.message || "Erro na requisição");
  }

  return data;
}

function openLogin(tab) {
  setAccessTab(tab);
  showScreen("loginScreen");
}

function openRegisterForCurrentTab() {
  if (currentAccessTab === "admin") {
    alert("Cadastro de admin não está habilitado nesta tela.");
    return;
  }
  showScreen("registerScreen");
}

function setAccessTab(tab) {
  currentAccessTab = tab;

  const loginTitle = byId("loginScreenTitle");
  const loginSubtitle = byId("loginScreenSubtitle");
  const registerTitle = byId("registerScreenTitle");
  const registerSubtitle = byId("registerScreenSubtitle");
  const goToRegisterBtn = byId("goToRegisterBtn");
  const role = byId("role");

  if (tab === "client") {
    if (loginTitle) loginTitle.textContent = "Entrar como Cliente";
    if (loginSubtitle) loginSubtitle.textContent = "Acesse sua área de cliente";
    if (registerTitle) registerTitle.textContent = "Criar conta de Cliente";
    if (registerSubtitle) registerSubtitle.textContent = "Cadastre-se para pedir passeios";
    if (goToRegisterBtn) goToRegisterBtn.classList.remove("hidden");
    if (role) role.value = "client";
  }

  if (tab === "walker") {
    if (loginTitle) loginTitle.textContent = "Entrar como Passeador";
    if (loginSubtitle) loginSubtitle.textContent = "Acesse sua área de passeador";
    if (registerTitle) registerTitle.textContent = "Criar conta de Passeador";
    if (registerSubtitle) registerSubtitle.textContent = "Cadastre-se para receber corridas";
    if (goToRegisterBtn) goToRegisterBtn.classList.remove("hidden");
    if (role) role.value = "walker";
  }

  if (tab === "admin") {
    if (loginTitle) loginTitle.textContent = "Entrar como Admin";
    if (loginSubtitle) loginSubtitle.textContent = "Acesse o painel administrativo";
    if (registerTitle) registerTitle.textContent = "Cadastro de Admin";
    if (registerSubtitle) registerSubtitle.textContent = "Cadastro desabilitado nesta tela";
    if (goToRegisterBtn) goToRegisterBtn.classList.add("hidden");
  }
}

function updatePaymentBoxDefault() {
  const box = byId("paymentStatusBox");
  if (!box) return;

  box.innerHTML = `
    <div class="payment-status-title">Nenhum pagamento gerado ainda.</div>
    <div class="payment-status-subtitle">Quando você gerar um pagamento, ele vai aparecer aqui de forma limpa.</div>
  `;
}

function renderPaymentBox(data) {
  const box = byId("paymentStatusBox");
  if (!box) return;

  latestMercadoPagoLink = data.sandbox_link || data.link_pagamento || null;

  box.innerHTML = `
    <div class="payment-status-title">Pagamento gerado com sucesso</div>
    <div class="payment-status-subtitle">Valor: R$ ${Number(data.amount || 0).toFixed(2)}</div>
    <div class="payment-status-subtitle">Status: ${data.status || "created"}</div>
    <div class="payment-status-subtitle">Solicitação: ${data.request_id ?? "não vinculada"}</div>
    <div class="request-actions">
      <button type="button" class="card-action-btn" id="openPaymentInlineBtn">Abrir pagamento</button>
    </div>
  `;

  byId("openPaymentInlineBtn")?.addEventListener("click", () => {
    if (latestMercadoPagoLink) {
      window.open(latestMercadoPagoLink, "_blank");
    }
  });
}

function renderAdminUsers(items) {
  const box = byId("adminUsersList");
  if (!box) return;

  box.innerHTML = "";

  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem registros.</div>`;
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "request-card";
    div.innerHTML = `
      <div class="request-card-top">
        <div class="request-card-title">${item.full_name}</div>
        <div><span class="tag">${item.role}</span></div>
      </div>
      <div class="request-meta">
        <span>E-mail: ${item.email}</span>
        <span>Cidade: ${item.city || "-"}</span>
        <span>Bairro: ${item.neighborhood || "-"}</span>
        <span class="${item.online ? "good" : "danger"}">${item.online ? "online" : "offline"}</span>
      </div>
    `;
    box.appendChild(div);
  });
}

function renderAdminRequests(items) {
  const box = byId("adminRequestsList");
  if (!box) return;

  box.innerHTML = "";

  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem solicitações ainda.</div>`;
    return;
  }

  items.slice(0, 8).forEach((item) => {
    const div = document.createElement("div");
    div.className = "request-card";
    div.innerHTML = `
      <div class="request-card-top">
        <div class="request-card-title">Solicitação #${item.id}</div>
        <div>
          <span class="tag">${item.status}</span>
          <span class="tag">${item.payment_status}</span>
        </div>
      </div>
      <div class="request-meta">
        <span>Cliente: ${item.client_id}</span>
        <span>Passeador: ${item.walker_id ?? "A definir"}</span>
        <span>Endereço: ${item.pickup_address || "-"}</span>
        <span>Valor: R$ ${Number(item.price || 0).toFixed(2)}</span>
      </div>
    `;
    box.appendChild(div);
  });
}

function renderClientRequests(items) {
  const box = byId("requestList");
  if (!box) return;

  box.innerHTML = "";

  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem solicitações.</div>`;
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "request-card";
    div.innerHTML = `
      <div class="request-card-top">
        <div class="request-card-title">Solicitação #${item.id}</div>
        <div>
          <span class="tag">${item.status}</span>
          <span class="tag">${item.payment_status}</span>
        </div>
      </div>

      <div class="request-meta">
        <span>Pet: ${item.pet_id ?? "-"}</span>
        <span>Passeador: ${item.walker_id ?? "A definir"}</span>
        <span>Endereço: ${item.pickup_address || "-"}</span>
        <span>Cidade/Bairro: ${item.city || "-"} / ${item.neighborhood || "-"}</span>
        <span>Duração: ${item.duration_minutes} minutos</span>
        <span>Valor: R$ ${Number(item.price || 0).toFixed(2)}</span>
      </div>

      <div class="request-actions">
        <button type="button" class="card-action-btn pay-btn" data-request-id="${item.id}" data-amount="${item.price || 35}">
          Gerar pagamento
        </button>
        <button type="button" class="ghost-btn chat-load-btn" data-request-id="${item.id}">
          Ver chat
        </button>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".pay-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = btn.dataset.requestId;
      const amount = btn.dataset.amount;
      await generateMercadoPagoPayment(requestId, amount);
    });
  });

  box.querySelectorAll(".chat-load-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = btn.dataset.requestId;
      if (byId("chat_load_request_id")) byId("chat_load_request_id").value = requestId;
      if (byId("chat_request_id")) byId("chat_request_id").value = requestId;
      await loadMessages();
    });
  });
}

function renderWalkerRequests(items) {
  const box = byId("walkerRequestsInfo");
  if (!box) return;

  box.innerHTML = "";

  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem solicitações para exibir.</div>`;
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "request-card";
    div.innerHTML = `
      <div class="request-card-top">
        <div class="request-card-title">Solicitação #${item.id}</div>
        <div>
          <span class="tag">${item.status}</span>
          <span class="tag">${item.payment_status}</span>
        </div>
      </div>

      <div class="request-meta">
        <span>Cliente: ${item.client_id}</span>
        <span>Pet: ${item.pet_id ?? "-"}</span>
        <span>Endereço: ${item.pickup_address || "-"}</span>
        <span>Duração: ${item.duration_minutes} minutos</span>
        <span>Valor: R$ ${Number(item.price || 0).toFixed(2)}</span>
      </div>

      <div class="request-actions">
        <button type="button" class="card-action-btn walker-action-btn" data-action="accept" data-request-id="${item.id}">
          Aceitar
        </button>
        <button type="button" class="secondary-btn walker-action-btn" data-action="decline" data-request-id="${item.id}">
          Recusar
        </button>
        <button type="button" class="dark-btn walker-action-btn" data-action="complete" data-request-id="${item.id}">
          Concluir
        </button>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".walker-action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentUser?.id) {
        alert("Sessão do passeador não encontrada.");
        return;
      }

      const action = btn.dataset.action;
      const requestId = btn.dataset.requestId;

      try {
        await api(`/walk-requests/${requestId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ actor_id: currentUser.id })
        });

        alert(`Ação "${action}" executada.`);
        await loadRequests();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function loadAdminDashboard() {
  try {
    const data = await api("/admin/dashboard");
    if (byId("metricTotalUsers")) byId("metricTotalUsers").textContent = data.total_users ?? 0;
    if (byId("metricClients")) byId("metricClients").textContent = data.total_clients ?? 0;
    if (byId("metricWalkers")) byId("metricWalkers").textContent = data.total_walkers ?? 0;
    if (byId("metricRevenue")) byId("metricRevenue").textContent = `R$ ${Number(data.total_revenue || 0).toFixed(2)}`;
    if (byId("metricRequests")) byId("metricRequests").textContent = data.total_requests ?? 0;
    if (byId("metricCompleted")) byId("metricCompleted").textContent = data.total_completed ?? 0;
    if (byId("metricPaid")) byId("metricPaid").textContent = data.total_paid ?? 0;

    const users = await api("/admin/users");
    renderAdminUsers(users);

    const requests = await api("/walk-requests");
    renderAdminRequests(requests);
  } catch (err) {
    alert(err.message);
  }
}

byId("goHomeBtn")?.addEventListener("click", goToCurrentHome);
byId("goWalkerPublicBtn")?.addEventListener("click", () => showScreen("walkerPublicScreen"));
byId("goAccessBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});
byId("logoutBtn")?.addEventListener("click", logout);

byId("heroHireBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});

byId("heroWalkerBtn")?.addEventListener("click", () => {
  showScreen("walkerPublicScreen");
});

byId("startNowBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});

byId("seeAccessBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});

byId("walkerPublicRegisterBtn")?.addEventListener("click", () => {
  setAccessTab("walker");
  showScreen("registerScreen");
});

byId("walkerPublicLoginBtn")?.addEventListener("click", () => {
  setAccessTab("walker");
  showScreen("loginScreen");
});

document.querySelectorAll(".access-open-btn").forEach((btn) => {
  btn.addEventListener("click", () => openLogin(btn.dataset.target));
});

byId("backToHomeBtn")?.addEventListener("click", () => showScreen("landingScreen"));
byId("goToRegisterBtn")?.addEventListener("click", openRegisterForCurrentTab);
byId("backToLoginBtn")?.addEventListener("click", () => showScreen("loginScreen"));

byId("loadMapBtn")?.addEventListener("click", loadMap);
byId("duration_minutes")?.addEventListener("change", syncEstimatedPrice);
window.addEventListener("load", tryAutoLocate);

byId("choosePhotoBtn")?.addEventListener("click", () => byId("profile_photo_file")?.click());

byId("clearPhotoBtn")?.addEventListener("click", () => {
  uploadedPhotoUrl = null;
  const profilePhoto = byId("profile_photo");
  const profilePhotoFile = byId("profile_photo_file");
  if (profilePhoto) profilePhoto.value = "";
  if (profilePhotoFile) profilePhotoFile.value = "";
  setPhotoPreview(null);
  setPhotoStatus("Nenhuma foto selecionada.");
});

byId("profile_photo_file")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) await handlePhotoFile(file);
});

const photoDropZone = byId("photoDropZone");
if (photoDropZone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    photoDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    photoDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropZone.classList.remove("dragover");
    });
  });

  photoDropZone.addEventListener("drop", async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await handlePhotoFile(file);
  });

  photoDropZone.addEventListener("click", () => byId("profile_photo_file")?.click());
}

byId("profile_photo")?.addEventListener("input", () => {
  const value = byId("profile_photo").value.trim();
  uploadedPhotoUrl = value || null;
  setPhotoPreview(value || null);
  setPhotoStatus(value ? "Link da foto informado manualmente." : "Nenhuma foto selecionada.");
});

byId("registerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (currentAccessTab === "admin") {
    alert("Cadastro de admin não está habilitado por esta tela.");
    return;
  }

  try {
    const payload = {
      full_name: byId("full_name")?.value || "",
      email: byId("email")?.value || "",
      password: byId("password")?.value || "",
      role: byId("role")?.value || "client",
      neighborhood: byId("neighborhood")?.value || "",
      city: byId("city")?.value || "",
      address: (byId("address")?.value || "") === "localhost" ? "" : (byId("address")?.value || ""),
      profile_photo: byId("profile_photo")?.value.trim() || uploadedPhotoUrl || null
    };

    const data = await api("/users/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    alert(`Conta criada com ID ${data.id}`);
    byId("registerForm").reset();
    uploadedPhotoUrl = null;
    setPhotoPreview(null);
    setPhotoStatus("Nenhuma foto selecionada.");
    showScreen("loginScreen");
  } catch (err) {
    alert(err.message);
  }
});

byId("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = byId("login_email")?.value?.trim() || "";
  const password = byId("login_password")?.value || "";

  if (!email || !password) {
    alert("Preencha e-mail e senha.");
    return;
  }

  try {
    let data;

    if (currentAccessTab === "admin") {
      data = await api("/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
    } else {
      data = await api("/users/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (currentAccessTab === "client" && data.role !== "client") {
        alert("Esse login não pertence a um cliente.");
        return;
      }

      if (currentAccessTab === "walker" && data.role !== "walker") {
        alert("Esse login não pertence a um passeador.");
        return;
      }
    }

    localStorage.setItem("session_user", JSON.stringify(data));
    renderSession(data);
  } catch (err) {
    alert(err.message);
  }
});

byId("petForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const payload = {
      owner_id: Number(byId("pet_owner_id")?.value),
      name: byId("pet_name")?.value || "",
      breed: byId("pet_breed")?.value || "",
      size: byId("pet_size")?.value || "medio",
      notes: byId("pet_notes")?.value || ""
    };

    const data = await api("/pets", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    alert(`Pet salvo com ID ${data.id}`);
  } catch (err) {
    alert(err.message);
  }
});

byId("walkerSearchForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const neighborhood = encodeURIComponent(byId("search_neighborhood")?.value || "");
    const city = encodeURIComponent(byId("search_city")?.value || "");
    const data = await api(`/walkers?neighborhood=${neighborhood}&city=${city}`);

    const box = byId("walkerList");
    if (!box) return;
    box.innerHTML = "";

    if (!data || data.length === 0) {
      box.innerHTML = `<div class="item">Nenhum passeador encontrado.</div>`;
      return;
    }

    data.forEach((item) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <strong>${item.full_name}</strong><br>
        <span class="tag">${item.city || "-"}</span>
        <span class="tag">${item.neighborhood || "-"}</span>
        <span class="${item.online ? "good" : "danger"}">${item.online ? "online" : "offline"}</span><br>
        ${item.profile_photo ? `<small>Foto: ${item.profile_photo}</small>` : "<small>Sem foto</small>"}
      `;
      box.appendChild(div);
    });
  } catch (err) {
    alert(err.message);
  }
});

byId("walkForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser || currentUser.role !== "client") {
    alert("Sessão do cliente não encontrada.");
    return;
  }

  try {
    const payload = {
      client_id: Number(currentUser.id),
      walker_id: null,
      pet_id: null,
      pickup_address: (byId("pickup_address")?.value || "") === "localhost" ? "" : (byId("pickup_address")?.value || ""),
      neighborhood: byId("walk_neighborhood")?.value || "",
      city: byId("walk_city")?.value || "",
      scheduled_at: byId("scheduled_at")?.value || null,
      duration_minutes: Number(byId("duration_minutes")?.value || 30),
      price: Number(byId("price")?.value || 0),
      notes: byId("walk_notes")?.value || ""
    };

    const data = await api("/walk-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    alert(`Solicitação criada com ID ${data.id}`);
    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

async function loadRequests() {
  try {
    let path = "/walk-requests";

    if (currentUser?.id && currentUser.role !== "admin") {
      path += `?user_id=${encodeURIComponent(currentUser.id)}`;
    }

    const data = await api(path);
    renderClientRequests(data);
    renderWalkerRequests(data);
  } catch (err) {
    console.log(err.message);
  }
}

byId("loadRequestsBtn")?.addEventListener("click", loadRequests);
byId("refreshAdminBtn")?.addEventListener("click", loadAdminDashboard);

byId("expireBtn")?.addEventListener("click", async () => {
  try {
    const data = await api("/maintenance/expire-invites", { method: "POST" });
    alert(`Convites expirados: ${data.count}`);
    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

byId("messageForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const payload = {
      walk_request_id: Number(byId("chat_request_id")?.value),
      sender_id: Number(byId("chat_sender_id")?.value),
      text: byId("chat_text")?.value || ""
    };

    await api("/messages", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (byId("chat_text")) byId("chat_text").value = "";
    await loadMessages();
  } catch (err) {
    alert(err.message);
  }
});

async function loadMessages() {
  try {
    const requestId = byId("chat_load_request_id")?.value || byId("chat_request_id")?.value || "";
    if (!requestId) throw new Error("Informe o ID da solicitação.");

    const data = await api(`/messages/${requestId}`);
    const box = byId("chatList");
    if (!box) return;

    box.innerHTML = "";

    if (!data || data.length === 0) {
      box.innerHTML = `<div class="item">Sem mensagens.</div>`;
      return;
    }

    data.forEach((item) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <strong>Usuário ${item.sender_id}</strong><br>
        ${item.text}
      `;
      box.appendChild(div);
    });
  } catch (err) {
    alert(err.message);
  }
}

byId("loadMessagesBtn")?.addEventListener("click", loadMessages);

async function generateMercadoPagoPayment(requestId = "", amount = "") {
  const resolvedRequestId = requestId || "";
  const resolvedAmount = amount || "35";

  try {
    const query = new URLSearchParams();
    if (resolvedRequestId) query.set("request_id", resolvedRequestId);
    if (resolvedAmount) query.set("amount", resolvedAmount);

    const path = query.toString() ? `/pagamento?${query.toString()}` : "/pagamento";
    const data = await api(path, { method: "GET" });
    renderPaymentBox(data);
  } catch (err) {
    alert(err.message);
  }
}

const session = localStorage.getItem("session_user");
if (session) {
  try {
    renderSession(JSON.parse(session));
  } catch {
    renderSession(null);
    showScreen("landingScreen");
  }
} else {
  renderSession(null);
  showScreen("landingScreen");
}

setAccessTab("client");
updatePaymentBoxDefault();
updateHeaderState();
syncEstimatedPrice();
loadRequests();
