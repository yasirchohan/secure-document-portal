// ====== SETTINGS ======
const DEMO = false;
const API_URL = " https://partridge-other-seismic.ngrok-free.dev";

function extraHeaders() {
  return { "ngrok-skip-browser-warning": "true" };
}

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
    const res = await fetch(API_URL + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders() },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error("Incorrect email or password.");
    const data = await res.json();
    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);
    localStorage.setItem("email", email);
    window.location.href = "dashboard.html";
  } catch (err) {
    errorBox.textContent = err.message;
  }
}

// ====== DASHBOARD SETUP ======
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

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

async function loadDocuments() {
  try {
    const res = await fetch(API_URL + "/documents", {
      headers: { Authorization: "Bearer " + localStorage.getItem("token"), ...extraHeaders() }
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
      headers: { Authorization: "Bearer " + localStorage.getItem("token"), ...extraHeaders() },
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
function addMessage(text, who) {
  const box = document.getElementById("chatBox");
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function handleAsk() {
  const input = document.getElementById("question");
  const q = input.value.trim();
  if (!q) return;
  addMessage(q, "user");
  input.value = "";

  try {
    const res = await fetch(API_URL + "/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token"),
        ...extraHeaders()
      },
      body: JSON.stringify({ question: q })
    });
    if (!res.ok) throw new Error("No response from the server.");
    const answer = (await res.json()).answer;
    addMessage(answer, "bot");
  } catch (err) {
    addMessage("Error: " + err.message, "bot");
  }
}

if (document.getElementById("chatBox")) initDashboard();