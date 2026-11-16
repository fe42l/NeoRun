/* =====================================================================
   NeoRun — الوظائف المشتركة
   - حسابات محلية بكلمة مرور (PBKDF2)
   - تشفير حقيقي AES-GCM بمفتاح مشتق من كلمة مرور المستخدم
   - تخزين المقاطع في IndexedDB (مشفّرة)
   - الهيدر وشريط التنقل والإشعارات
   ===================================================================== */
(function () {
  "use strict";

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const PBKDF2_ITERATIONS = 210000;

  // ---------------- أدوات مساعدة ----------------
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  const session = {
    get() {
      try { return JSON.parse(sessionStorage.getItem("nr_session")); } catch { return null; }
    },
    set(v) { try { sessionStorage.setItem("nr_session", JSON.stringify(v)); } catch { /* ignore */ } },
    clear() { try { sessionStorage.removeItem("nr_session"); } catch { /* ignore */ } },
  };

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------------- التشفير ----------------
  function cryptoAvailable() {
    return !!(window.crypto && crypto.subtle);
  }

  // يشتق 512 بت: النصف الأول للتحقق من كلمة المرور، والنصف الثاني مفتاح التشفير
  async function deriveMaterial(password, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      base,
      512
    );
    return { verifier: bits.slice(0, 32), keyRaw: bits.slice(32, 64) };
  }

  async function importAesKey(rawB64) {
    return crypto.subtle.importKey("raw", fromB64(rawB64), "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  let cachedKey = null;
  async function currentKey() {
    const s = session.get();
    if (!s) return null;
    if (!cachedKey) cachedKey = await importAesKey(s.key);
    return cachedKey;
  }

  async function encryptBytes(bytes) {
    const key = await currentKey();
    if (!key) throw new Error("not-logged-in");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { iv, data };
  }

  async function decryptBytes(iv, data) {
    const key = await currentKey();
    if (!key) throw new Error("not-logged-in");
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  }

  async function encryptJSON(obj) {
    const { iv, data } = await encryptBytes(enc.encode(JSON.stringify(obj)));
    return { v: 1, iv: toB64(iv), ct: toB64(data) };
  }

  async function decryptJSON(payload) {
    if (!payload || payload.v !== 1) return null;
    const plain = await decryptBytes(fromB64(payload.iv), fromB64(payload.ct));
    return JSON.parse(dec.decode(plain));
  }

  // ---------------- الحسابات ----------------
  const normUser = (u) => String(u || "").trim().toLowerCase();

  async function register(username, password) {
    const user = normUser(username);
    if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(user)) {
      throw new Error("اسم المستخدم يجب أن يكون 3–24 حرفاً (حروف، أرقام، _ . -)");
    }
    if (String(password).length < 8) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف");
    const users = store.get("nr_users", {});
    if (users[user]) throw new Error("اسم المستخدم مستخدم مسبقاً");

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { verifier, keyRaw } = await deriveMaterial(password, salt);
    users[user] = { salt: toB64(salt), verifier: toB64(verifier), created: Date.now() };
    if (!store.set("nr_users", users)) throw new Error("تعذّر الحفظ في المتصفح");
    cachedKey = null;
    session.set({ user, key: toB64(keyRaw) });
    return user;
  }

  async function login(username, password) {
    const user = normUser(username);
    const rec = store.get("nr_users", {})[user];
    if (!rec) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
    const { verifier, keyRaw } = await deriveMaterial(password, fromB64(rec.salt));
    const a = new Uint8Array(verifier);
    const b = fromB64(rec.verifier);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
    if (diff !== 0) throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
    cachedKey = null;
    session.set({ user, key: toB64(keyRaw) });
    return user;
  }

  function logout() {
    cachedKey = null;
    session.clear();
  }

  const currentUser = () => (session.get() || {}).user || null;

  function requireLogin() {
    if (currentUser()) return true;
    const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.replace("login.html?next=" + next);
    return false;
  }

  // ---------------- بيانات المستخدم المشفّرة ----------------
  async function loadUserData(name, fallback) {
    const user = currentUser();
    if (!user) return fallback;
    try {
      const v = await decryptJSON(store.get(`nr_${name}_${user}`));
      return v ?? fallback;
    } catch { return fallback; }
  }

  async function saveUserData(name, value) {
    const user = currentUser();
    if (!user) throw new Error("not-logged-in");
    if (!store.set(`nr_${name}_${user}`, await encryptJSON(value))) {
      throw new Error("مساحة التخزين ممتلئة");
    }
  }

  // ---------------- IndexedDB للمقاطع ----------------
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB غير مدعوم"));
      const req = indexedDB.open("neorun", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("videos")) {
          const os = db.createObjectStore("videos", { keyPath: "id" });
          os.createIndex("user", "user");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbTx(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("videos", mode);
      const result = fn(tx.objectStore("videos"));
      tx.oncomplete = () => { db.close(); resolve(result && "result" in result ? result.result : result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("aborted")); };
    });
  }

  async function saveVideo(blob, meta) {
    const user = currentUser();
    if (!user) throw new Error("not-logged-in");
    const { iv, data } = await encryptBytes(await blob.arrayBuffer());
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await dbTx("readwrite", (os) => os.put({ id, user, iv, data, mime: blob.type, ...meta }));
    return id;
  }

  async function listVideos() {
    const user = currentUser();
    if (!user) return [];
    const all = await dbTx("readonly", (os) => os.index("user").getAll(user));
    return (all || []).sort((a, b) => b.date - a.date);
  }

  async function videoBlob(rec) {
    const plain = await decryptBytes(rec.iv, rec.data);
    return new Blob([plain], { type: rec.mime || "video/webm" });
  }

  const deleteVideo = (id) => dbTx("readwrite", (os) => os.delete(id));

  async function deleteAllUserData() {
    const user = currentUser();
    if (!user) return;
    const vids = await listVideos().catch(() => []);
    if (vids.length) await dbTx("readwrite", (os) => vids.forEach((v) => os.delete(v.id)));
    store.remove(`nr_profile_${user}`);
    store.remove(`nr_history_${user}`);
    const users = store.get("nr_users", {});
    delete users[user];
    store.set("nr_users", users);
    logout();
  }

  // ---------------- واجهة: إشعارات ----------------
  function toast(msg, type = "") {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------------- واجهة: الهيدر والتنقل ----------------
  const NAV = [
    { href: "index.html", icon: "fa-house", label: "الرئيسية" },
    { href: "camera.html", icon: "fa-person-running", label: "التمرين" },
    { href: "profile.html", icon: "fa-id-card", label: "ملفي" },
    { href: "videos.html", icon: "fa-clock-rotate-left", label: "السجل" },
    { href: "privacy.html", icon: "fa-shield-halved", label: "الخصوصية" },
  ];

  function renderChrome() {
    const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const user = currentUser();
    const links = NAV.map((n) =>
      `<a href="${n.href}" class="${n.href === page ? "active" : ""}"${n.href === page ? ' aria-current="page"' : ""}>` +
      `<i class="fa-solid ${n.icon}" aria-hidden="true"></i><span>${n.label}</span></a>`
    ).join("");

    const chip = user
      ? `<button class="user-chip" id="nr-logout" title="تسجيل الخروج"><i class="fa-solid fa-user"></i>${escapeHtml(user)}<i class="fa-solid fa-right-from-bracket"></i></button>`
      : `<a class="user-chip" href="login.html"><i class="fa-solid fa-right-to-bracket"></i>دخول</a>`;

    const header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML =
      `<div class="topbar-inner">` +
      `<a class="brand" href="index.html"><img src="assets/logo.svg" alt="">NeoRun</a>` +
      `<nav class="nav-links" aria-label="التنقل الرئيسي">${links}</nav>${chip}</div>`;
    document.body.prepend(header);

    const bottom = document.createElement("nav");
    bottom.className = "bottom-nav";
    bottom.setAttribute("aria-label", "التنقل");
    bottom.innerHTML = links;
    document.body.appendChild(bottom);

    const out = document.getElementById("nr-logout");
    if (out) out.addEventListener("click", () => {
      logout();
      location.href = "login.html";
    });
  }

  const fmtDate = (ts) => new Date(ts).toLocaleString("ar", {
    dateStyle: "medium", timeStyle: "short",
  });

  const fmtDuration = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };

  window.NR = {
    store, escapeHtml, toast, fmtDate, fmtDuration,
    cryptoAvailable, register, login, logout, currentUser, requireLogin,
    loadUserData, saveUserData,
    saveVideo, listVideos, videoBlob, deleteVideo, deleteAllUserData,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderChrome);
  } else {
    renderChrome();
  }
})();
