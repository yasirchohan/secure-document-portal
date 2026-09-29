// ====== SETTINGS ======
const DEMO = false;
const API_URL = "http://127.0.0.1:8000";  // FastAPI address (later)

// ====== LOGIN ======
async function handleLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorBox = document.getElementById("error");
  errorBox.textContent = "";

  if (!email || !password) {
    errorBox.textContent = "Please enter both email and password.";
    return;
  }

  try {
    let data;
    if (DEMO) {
      data = { token: "demo-token",
               role: email.includes("admin") ? "admin" : "employee" };
    } else {
      const res = await fetch(API_URL + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) throw new Error("Incorrect email or password.");
      data = await res.json();
    }
    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);
    localStorage.setItem("email", email);
    window.location.href = "dashboard.html";
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

// ====== DASHBOARD SETUP ======
function initDashboard() {
  if (!localStorage.getItem("token")) {   // not logged in -> back to login page
    window.location.href = "login.html";
    return;
  }
  document.getElementById("userInfo").textContent =
    localStorage.getItem("email") + " (" + localStorage.getItem("role") + ")";
  addMessage("Hello! Ask me anything about your documents.", "bot");
}

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

// ====== UPLOAD ======
async function handleUpload() {
  const file = document.getElementById("fileInput").files[0];
  const access = document.getElementById("access").value;
  const msg = document.getElementById("uploadMsg");
  msg.textContent = "";

  if (!file) { msg.textContent = "Please select a file first."; return; }
  if (file.size > 10 * 1024 * 1024) { msg.textContent = "File must be smaller than 10MB."; return; }

  try {
    const form = new FormData();
    form.append("file", file);
    form.append("allowed_role", access);
    const res = await fetch(API_URL + "/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + localStorage.getItem("token") },
      body: form
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Upload failed.");
    }
        document.getElementById("fileInput").value = "";
    await loadDocuments();
  } catch (err) {
    msg.textContent = err.message;
  }
}

// ====== CHAT ======
async function initDashboard() {
  if (!localStorage.getItem("token")) {
    window.location.href = "login.html";
    return;
  }
  document.getElementById("userInfo").textContent =
    localStorage.getItem("email") + " (" + localStorage.getItem("role") + ")";
  addMessage("Hello! Ask me anything about your documents.", "bot");
  await loadDocuments();
}

async function loadDocuments() {
  try {
    const res = await fetch(API_URL + "/documents", {
      headers: { Authorization: "Bearer " + localStorage.getItem("token") }
    });
    if (!res.ok) return;
    const docs = await res.json();
    const list = document.getElementById("fileList");
    list.innerHTML = "";
    docs.forEach(doc => {
      const li = document.createElement("li");
      li.textContent = doc.original_name + "  [" + doc.allowed_role + "]";
      list.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}
// run dashboard setup only on the dashboard page
if (document.getElementById("chatBox")) initDashboard();