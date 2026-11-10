const $ = (id) => document.getElementById(id);
let mode = "login";
let currentUser = null;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showAuth() {
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
}
function showApp(user) {
  currentUser = user;
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("welcomeTitle").textContent = user.role === "owner" ? "All servers" : "Your servers";
  $("welcomeSub").textContent = user.email;
  $("roleTag").textContent = user.role.toUpperCase();
  $("ownerSection").classList.toggle("hidden", user.role !== "owner");
  loadServers();
  if (user.role === "owner") loadOwnerData();
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  mode = btn.dataset.mode;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
  $("authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authMessage").textContent = "";
}));
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("authSubmit").disabled = true;
  $("authMessage").textContent = "Please wait…";
  try {
    const data = await api(mode === "login" ? "/login" : "/register", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value, password: $("password").value })
    });
    showApp(data.user);
  } catch (err) { $("authMessage").textContent = err.message; }
  finally { $("authSubmit").disabled = false; }
});
$("logoutBtn").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST", body: "{}" }); } catch {}
  currentUser = null; showAuth();
});
$("newServerBtn").addEventListener("click", () => $("createDialog").showModal());
$("closeDialog").addEventListener("click", () => $("createDialog").close());
$("createForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("createMessage").textContent = "Creating…";
  try {
    await api("/servers", { method: "POST", body: JSON.stringify({ name: $("serverName").value, edition: $("edition").value }) });
    $("createDialog").close(); $("serverName").value = ""; $("createMessage").textContent = "";
    await loadServers();
  } catch (err) { $("createMessage").textContent = err.message; }
});
async function loadServers() {
  const grid = $("serverGrid");
  grid.innerHTML = '<div class="empty">Loading servers…</div>';
  try {
    const { servers } = await api("/servers");
    if (!servers.length) {
      grid.innerHTML = '<div class="empty">No server records yet.<br>Tap “Create server” to add your first one.</div>';
      return;
    }
    grid.innerHTML = servers.map(s => `
      <article class="server-card">
        <div class="server-top"><div><h3>${escapeHtml(s.name)}</h3><span class="muted small">${escapeHtml(s.customer_email || "")}</span></div><span class="edition">${escapeHtml(s.edition)}</span></div>
        <div class="server-meta">Version: ${escapeHtml(s.version)} · ${s.ram_mb} MB RAM allocation<br>Status: <strong>Node not connected</strong></div>
        <div class="server-actions">
          <button class="ghost disabled-action" disabled title="Connect a real node first">Start</button>
          <button class="ghost disabled-action" disabled>Stop</button>
          <button class="ghost disabled-action" disabled>Console</button>
          <button class="ghost delete-server" data-id="${s.id}">Delete record</button>
        </div>
      </article>`).join("");
    grid.querySelectorAll(".delete-server").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("Delete this server record? This does not affect a running Minecraft server.")) return;
      try { await api(`/servers/${btn.dataset.id}/delete`, { method: "DELETE" }); await loadServers(); }
      catch (e) { alert(e.message); }
    }));
  } catch (e) { grid.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`; }
}
async function loadOwnerData() {
  try {
    const [customers, audit] = await Promise.all([api("/admin/customers"), api("/admin/audit")]);
    $("customerList").innerHTML = customers.customers.map(c => `
      <div class="data-row"><span>${escapeHtml(c.email)}<br><small>${escapeHtml(c.status)} · ${escapeHtml(c.role)}</small></span>
      ${c.role === "customer" && c.status === "active" ? `<button class="ghost suspend" data-id="${c.id}">Suspend</button>` : ""}</div>`).join("") || "No accounts yet.";
    $("customerList").querySelectorAll(".suspend").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("Suspend this customer and end their sessions?")) return;
      try { await api(`/admin/customers/${btn.dataset.id}/suspend`, { method: "POST", body: "{}" }); await loadOwnerData(); }
      catch (e) { alert(e.message); }
    }));
    $("auditList").innerHTML = audit.logs.map(log => `<div class="data-row"><span>${escapeHtml(log.action)}<br><small>${escapeHtml(log.actor_email || "system")} · ${escapeHtml(log.created_at)}</small></span></div>`).join("") || "No activity yet.";
  } catch (e) { $("customerList").textContent = e.message; }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
(async function init() {
  try { const data = await api("/me"); showApp(data.user); }
  catch { showAuth(); }
})();
