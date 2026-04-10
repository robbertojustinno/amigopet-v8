const API = window.API_BASE_URL || "/api";

const byId = (id) => document.getElementById(id);

let uploadedPhotoUrl = null;
let currentCoords = null;
let latestMercadoPagoLink = null;
let currentAccessTab = "client";
let currentUser = null;

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });
  byId(screenId)?.classList.add("active");
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function updateHeaderState() {
  const logoutBtn = byId("logoutBtn");
  if (!logoutBtn) return;

  if (currentUser) {
    logoutBtn.classList.remove("hidden");
  } else {
    logoutBtn.classList.add("hidden");
  }
}

function renderSession(user) {
  currentUser = user || null;

  const sessionBox = byId("sessionBox");
  if (sessionBox) {
    if (!user) {
      sessionBox.textContent = "Nenhum";
    } else {
      sessionBox.textContent = [
        `ID: ${user.id ?? "-"}`,
        `Nome: ${user.full_name ?? "-"}`,
        `E-mail: ${user.email ?? "-"}`,
        `Perfil: ${
          user.role === "walker"
            ? "Passeador"
            : user.role === "client"
              ? "Cliente"
              : user.role === "admin"
                ? "Admin"
                : (user.role ?? "-")
        }`,
        `Bairro: ${user.neighborhood || "-"}`,
        `Cidade: ${user.city || "-"}`,
        `Endereço: ${user.address || "-"}`,
        `Online: ${user.online ? "Sim" : "Não"}`
      ].join("\n");
    }
  }

  if (!user) {
    updateHeaderState();
    return;
  }

  if (user.role === "admin") {
    showScreen("adminDashboard");
    byId("adminSessionInfo") && (byId("adminSessionInfo").textContent = `${user.full_name || "Admin"} conectado`);
    loadAdminDashboard();
  } else if (user.role === "walker") {
    showScreen("walkerDashboard");
    byId("walkerSessionInfo") && (byId("walkerSessionInfo").textContent = `${user.full_name || "Passeador"} conectado`);
    loadRequests();
  } else {
    showScreen("clientDashboard");
    byId("clientSessionInfo") && (byId("clientSessionInfo").textContent = `${user.full_name || "Cliente"} conectado`);
    loadRequests();
  }

  updateHeaderState();
}

function logout() {
  localStorage.removeItem("session_user");
  currentUser = null;
  currentAccessTab = "client";
  latestMercadoPagoLink = null;
  renderSession(null);
  setAccessTab("client");
  showScreen("landingScreen");
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

function renderList(targetId, items, formatter) {
  const box = byId(targetId);
  if (!box) return;

  box.innerHTML = "";

  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem registros.</div>`;
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = formatter(item);
    box.appendChild(div);
  });
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
  `;
}

async function loadAdminDashboard() {
  try {
    const data = await api("/admin/dashboard");
    if (byId("metricTotalUsers")) byId("metricTotalUsers").textContent = data.total_users ?? 0;
    if (byId("metricClients")) byId("metricClients").textContent = data.total_clients ?? 0;
    if (byId("metricWalkers")) byId("metricWalkers").textContent = data.total_walkers ?? 0;
    if (byId("metricRevenue")) byId("metricRevenue").textContent = `R$ ${Number(data.total_revenue || 0).toFixed(2)}`;

    const users = await api("/admin/users");
    renderList("adminUsersList", users, (item) => `
      <strong>${item.full_name}</strong><br>
      E-mail: ${item.email}<br>
      Perfil: <span class="tag">${item.role}</span>
      <span class="tag">${item.city || "-"}</span>
      <span class="${item.online ? "good" : "danger"}">${item.online ? "online" : "offline"}</span>
    `);
  } catch (err) {
    alert(err.message);
  }
}

byId("goHomeBtn")?.addEventListener("click", () => {
  showScreen("landingScreen");
});

byId("logoutBtn")?.addEventListener("click", logout);

byId("startNowBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});

byId("seeAccessBtn")?.addEventListener("click", () => {
  document.getElementById("accessSection")?.scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll(".access-open-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    openLogin(btn.dataset.target);
  });
});

byId("backToHomeBtn")?.addEventListener("click", () => {
  showScreen("landingScreen");
});

byId("goToRegisterBtn")?.addEventListener("click", openRegisterForCurrentTab);

byId("backToLoginBtn")?.addEventListener("click", () => {
  showScreen("loginScreen");
});

byId("loadMapBtn")?.addEventListener("click", loadMap);
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

    renderList("walkerList", data, (item) => `
      <strong>${item.full_name}</strong><br>
      ID: ${item.id}<br>
      <span class="tag">${item.role}</span>
      <span class="tag">${item.city || "-"}</span>
      <span class="tag">${item.neighborhood || "-"}</span>
      <span class="${item.online ? "good" : "danger"}">${item.online ? "online" : "offline"}</span><br>
      ${item.profile_photo ? `<small>Foto: ${item.profile_photo}</small>` : "<small>Sem foto</small>"}
    `);
  } catch (err) {
    alert(err.message);
  }
});

byId("walkForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    const payload = {
      client_id: Number(byId("client_id")?.value),
      walker_id: byId("walker_id")?.value ? Number(byId("walker_id").value) : null,
      pet_id: byId("pet_id")?.value ? Number(byId("pet_id").value) : null,
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

    if (byId("action_request_id")) byId("action_request_id").value = data.id;
    if (byId("mp_request_id")) byId("mp_request_id").value = data.id;
    if (byId("action_amount")) byId("action_amount").value = payload.price || 35;
    if (byId("mp_amount")) byId("mp_amount").value = payload.price || 35;

    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

async function loadRequests() {
  try {
    const userId = byId("request_user_id")?.value || "";
    const q = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    const data = await api(`/walk-requests${q}`);

    renderList("requestList", data, (item) => {
      const statusTag = `<span class="tag">${item.status}</span>`;
      const payTag = `<span class="tag">${item.payment_status}</span>`;

      return `
        <strong>Solicitação #${item.id}</strong><br>
        Cliente: ${item.client_id} | Passeador: ${item.walker_id ?? "-"} | Pet: ${item.pet_id ?? "-"}<br>
        Endereço: ${item.pickup_address}<br>
        Cidade/Bairro: ${item.city || "-"} / ${item.neighborhood || "-"}<br>
        Duração: ${item.duration_minutes} min | Valor: R$ ${item.price}<br>
        ${statusTag} ${payTag}<br>
        <small>${item.notes || ""}</small>
      `;
    });

    renderList("walkerRequestsInfo", data, (item) => `
      <strong>Solicitação #${item.id}</strong><br>
      Cliente: ${item.client_id}<br>
      Status: <span class="tag">${item.status}</span>
      Pagamento: <span class="tag">${item.payment_status}</span>
    `);
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

    renderList("chatList", data, (item) => `
      <strong>Usuário ${item.sender_id}</strong><br>
      ${item.text}
    `);
  } catch (err) {
    alert(err.message);
  }
}

byId("loadMessagesBtn")?.addEventListener("click", loadMessages);

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.getAttribute("data-action");
    const requestId = Number(byId("action_request_id")?.value);
    const actorId = Number(byId("action_actor_id")?.value);
    const amount = Number(byId("action_amount")?.value || 0);

    if (!requestId || !actorId) {
      alert("Informe ID da solicitação e ID do ator.");
      return;
    }

    try {
      let data;

      if (action === "pay") {
        data = await api(`/walk-requests/${requestId}/pay`, {
          method: "POST",
          body: JSON.stringify({ actor_id: actorId, amount })
        });
      } else {
        data = await api(`/walk-requests/${requestId}/${action}`, {
          method: "POST",
          body: JSON.stringify({ actor_id: actorId })
        });
      }

      if (byId("actionResult")) byId("actionResult").textContent = pretty(data);
      await loadRequests();
    } catch (err) {
      if (byId("actionResult")) byId("actionResult").textContent = err.message;
    }
  });
});

async function generateMercadoPagoPayment() {
  const requestId = byId("mp_request_id")?.value.trim() || "";
  const amount = byId("mp_amount")?.value.trim() || "";

  try {
    const query = new URLSearchParams();
    if (requestId) query.set("request_id", requestId);
    if (amount) query.set("amount", amount);

    const path = query.toString() ? `/pagamento?${query.toString()}` : "/pagamento";
    const data = await api(path, { method: "GET" });
    renderPaymentBox(data);
  } catch (err) {
    alert(err.message);
  }
}

byId("generateMpPaymentBtn")?.addEventListener("click", generateMercadoPagoPayment);

byId("openMpPaymentBtn")?.addEventListener("click", async () => {
  if (!latestMercadoPagoLink) {
    await generateMercadoPagoPayment();
  }

  if (!latestMercadoPagoLink) {
    alert("Nenhum link de pagamento disponível.");
    return;
  }

  window.open(latestMercadoPagoLink, "_blank");
});

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
loadRequests();
