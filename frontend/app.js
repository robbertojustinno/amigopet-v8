const API = window.API_BASE_URL || "/api";

const byId = (id) => document.getElementById(id);

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function buildMapUrl(address) {
  const q = encodeURIComponent(address);
  return `https://www.openstreetmap.org/export/embed.html?search=${q}&marker=1&query=${q}`;
}

function loadMap() {
  const address = byId("mapAddress").value.trim();
  byId("mapFrame").src = buildMapUrl(address);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Erro na requisição");
  }
  return data;
}

function renderList(targetId, items, formatter) {
  const box = byId(targetId);
  box.innerHTML = "";
  if (!items || items.length === 0) {
    box.innerHTML = `<div class="item">Sem registros.</div>`;
    return;
  }
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = formatter(item);
    box.appendChild(div);
  });
}

byId("loadMapBtn").addEventListener("click", loadMap);
window.addEventListener("load", loadMap);

byId("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = {
      full_name: byId("full_name").value,
      email: byId("email").value,
      password: byId("password").value,
      role: byId("role").value,
      neighborhood: byId("neighborhood").value,
      city: byId("city").value,
      address: byId("address").value,
      profile_photo: byId("profile_photo").value || null
    };
    const data = await api("/users/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    alert(`Conta criada com ID ${data.id}`);
  } catch (err) {
    alert(err.message);
  }
});

byId("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = {
      email: byId("login_email").value,
      password: byId("login_password").value
    };
    const data = await api("/users/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    localStorage.setItem("session_user", JSON.stringify(data));
    byId("sessionBox").textContent = pretty(data);
  } catch (err) {
    alert(err.message);
  }
});

byId("petForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = {
      owner_id: Number(byId("pet_owner_id").value),
      name: byId("pet_name").value,
      breed: byId("pet_breed").value,
      size: byId("pet_size").value,
      notes: byId("pet_notes").value
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

byId("walkerSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const neighborhood = encodeURIComponent(byId("search_neighborhood").value || "");
    const city = encodeURIComponent(byId("search_city").value || "");
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

byId("walkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = {
      client_id: Number(byId("client_id").value),
      walker_id: byId("walker_id").value ? Number(byId("walker_id").value) : null,
      pet_id: byId("pet_id").value ? Number(byId("pet_id").value) : null,
      pickup_address: byId("pickup_address").value,
      neighborhood: byId("walk_neighborhood").value,
      city: byId("walk_city").value,
      scheduled_at: byId("scheduled_at").value || null,
      duration_minutes: Number(byId("duration_minutes").value || 30),
      price: Number(byId("price").value || 0),
      notes: byId("walk_notes").value
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
    const userId = byId("request_user_id").value;
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
  } catch (err) {
    alert(err.message);
  }
}

byId("loadRequestsBtn").addEventListener("click", loadRequests);

byId("expireBtn").addEventListener("click", async () => {
  try {
    const data = await api("/maintenance/expire-invites", { method: "POST" });
    alert(`Convites expirados: ${data.count}`);
    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

byId("messageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = {
      walk_request_id: Number(byId("chat_request_id").value),
      sender_id: Number(byId("chat_sender_id").value),
      text: byId("chat_text").value
    };
    await api("/messages", { method: "POST", body: JSON.stringify(payload) });
    byId("chat_text").value = "";
    await loadMessages();
  } catch (err) {
    alert(err.message);
  }
});

async function loadMessages() {
  try {
    const requestId = byId("chat_load_request_id").value || byId("chat_request_id").value;
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

byId("loadMessagesBtn").addEventListener("click", loadMessages);

document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.getAttribute("data-action");
    const requestId = Number(byId("action_request_id").value);
    const actorId = Number(byId("action_actor_id").value);
    const amount = Number(byId("action_amount").value || 0);
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
      byId("actionResult").textContent = pretty(data);
      await loadRequests();
    } catch (err) {
      byId("actionResult").textContent = err.message;
    }
  });
});

const session = localStorage.getItem("session_user");
if (session) byId("sessionBox").textContent = session;
loadRequests();
