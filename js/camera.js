/* =====================================================================
   NeoRun — صفحة التمرين: الكاميرا + MoveNet + العدّ + التسجيل
   ===================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const { EXERCISES, RepCounter, toMap, MIN_SCORE } = window.NRExercise;

  const video = $("camera");
  const canvas = $("overlay");
  const ctx = canvas.getContext("2d");

  const state = {
    detector: null,
    stream: null,
    facing: "user",
    running: false,
    busy: false,
    counter: null,
    exerciseKey: "squat",
    startedAt: 0,
    timerId: null,
    recorder: null,
    chunks: [],
    recordLimitId: null,
    wakeLock: null,
    lastSpoken: { msg: "", at: 0 },
    lastLevel: "",
    countdown: false,
  };

  const RECORD_LIMIT_MS = 3 * 60 * 1000;

  // ---------------- الواجهة ----------------
  function setFeedback(level, msg) {
    const el = $("feedback");
    el.className = "feedback " + (level || "");
    const icon = { ok: "fa-circle-check", warn: "fa-triangle-exclamation", bad: "fa-circle-xmark" }[level] || "fa-circle-info";
    el.querySelector("i").className = "fa-solid " + icon;
    $("feedback-text").textContent = msg;
  }

  function setStageMsg(msg) {
    $("stage-empty").classList.toggle("hidden", !msg);
    if (msg) $("stage-msg").textContent = msg;
  }

  function updateReps() {
    const c = state.counter ? state.counter.count : 0;
    const good = state.counter ? state.counter.good : 0;
    const target = Math.max(1, parseInt($("target").value, 10) || 1);
    $("reps").textContent = c;
    $("reps-sub").textContent = c ? `تكرار · ${good} بوضعية صحيحة` : "تكرار";
    $("progress").style.width = Math.min(100, (c / target) * 100) + "%";
  }

  function updateLabels() {
    const ex = EXERCISES[state.exerciseKey];
    $("angle-main-label").textContent = ex.mainLabel;
    $("angle-form-label").textContent = ex.formLabel;
  }

  function speak(msg, force = false) {
    if (!$("voice").checked || !("speechSynthesis" in window)) return;
    const now = performance.now();
    if (!force && (msg === state.lastSpoken.msg && now - state.lastSpoken.at < 6000)) return;
    if (!force && now - state.lastSpoken.at < 1800) return;
    state.lastSpoken = { msg, at: now };
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.lang = "ar-SA";
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  function tickTimer() {
    $("hud-timer").textContent = NR.fmtDuration((Date.now() - state.startedAt) / 1000);
  }

  // ---------------- النموذج ----------------
  async function loadModel() {
    if (state.detector) return state.detector;
    if (typeof poseDetection === "undefined" || typeof tf === "undefined") {
      throw new Error("تعذّر تحميل مكتبات الذكاء الاصطناعي — تحقّق من اتصالك بالإنترنت");
    }
    setStageMsg("جاري تحميل نموذج الذكاء الاصطناعي…");
    try { await tf.setBackend("webgl"); } catch { /* يُستخدم المتاح */ }
    await tf.ready();
    state.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true,
    });
    return state.detector;
  }

  // ---------------- الكاميرا ----------------
  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("المتصفح لا يدعم الكاميرا، أو الصفحة ليست عبر https");
    }
    stopStream();
    setStageMsg("جاري تشغيل الكاميرا…");
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: state.facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    video.srcObject = state.stream;
    await new Promise((res) => {
      if (video.readyState >= 1) res();
      else video.onloadedmetadata = () => res();
    });
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    $("stage").style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    $("mirror").style.transform = state.facing === "user" ? "scaleX(-1)" : "none";
  }

  function stopStream() {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    video.srcObject = null;
  }

  // ---------------- الرسم ----------------
  const PAIRS = () => poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
  let pairsCache = null;

  function draw(keypoints, active, level) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!keypoints) return;
    const scale = Math.max(1, canvas.width / 480);
    pairsCache = pairsCache || PAIRS();

    ctx.lineCap = "round";
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    for (const [i, j] of pairsCache) {
      const a = keypoints[i];
      const b = keypoints[j];
      if (a.score >= MIN_SCORE && b.score >= MIN_SCORE) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    const color = { ok: "#22c55e", warn: "#f59e0b", bad: "#ef4444" }[level] || "#a78bfa";
    if (active && active.length) {
      ctx.lineWidth = 6 * scale;
      ctx.strokeStyle = color;
      ctx.beginPath();
      active.forEach((p, idx) => {
        // تمرين رفع الذراعين يحتوي جهتين (4 نقاط لكل جهة)
        if (idx === 0 || (active.length === 8 && idx === 4)) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    for (const k of keypoints) {
      if (k.score < MIN_SCORE) continue;
      ctx.beginPath();
      ctx.arc(k.x, k.y, 4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    if (active) {
      for (const p of active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
  }

  // ---------------- حلقة التتبع ----------------
  async function loop() {
    if (!state.running) return;
    if (!state.busy && video.readyState >= 2 && !state.countdown) {
      state.busy = true;
      try {
        const poses = await state.detector.estimatePoses(video, { flipHorizontal: false });
        handlePose(poses && poses[0]);
      } catch (err) {
        console.error(err);
      } finally {
        state.busy = false;
      }
    }
    requestAnimationFrame(loop);
  }

  function handlePose(pose) {
    const ex = EXERCISES[state.exerciseKey];
    const map = pose ? toMap(pose.keypoints) : {};
    const m = pose ? ex.measure(map) : null;
    const r = state.counter.update(m);

    draw(pose && pose.keypoints, m && m.joints, r.level);
    $("angle-main").textContent = Number.isFinite(r.main) ? Math.round(r.main) + "°" : "—";
    $("angle-form").textContent = Number.isFinite(r.form) ? Math.round(r.form) + "°" : "—";
    setFeedback(r.level, r.msg);

    if (r.event === "rep") {
      updateReps();
      const target = parseInt($("target").value, 10) || 0;
      if (target && state.counter.count === target) {
        speak(`أحسنت! أكملت ${target} تكرار`, true);
        NR.toast("🎉 وصلت إلى هدفك!", "ok");
      } else {
        speak(String(state.counter.count), true);
      }
    } else if (r.level === "bad" && state.lastLevel !== "bad") {
      speak(r.msg);
    } else if (r.event === "partial") {
      speak(r.msg);
    }
    state.lastLevel = r.level;
  }

  async function countdown() {
    state.countdown = true;
    for (let i = 3; i >= 1; i--) {
      setStageMsg(`استعد… ${i}`);
      speak(String(i), true);
      await new Promise((r) => setTimeout(r, 900));
      if (!state.running) break;
    }
    setStageMsg("");
    state.countdown = false;
  }

  // ---------------- التسجيل ----------------
  function pickMime() {
    if (typeof MediaRecorder === "undefined") return null;
    const options = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
    return options.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function startRecording() {
    const mime = pickMime();
    if (mime === null) { NR.toast("التسجيل غير مدعوم في هذا المتصفح", "bad"); return; }
    state.chunks = [];
    state.recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime, videoBitsPerSecond: 1_000_000 } : undefined);
    state.recorder.ondataavailable = (e) => e.data && e.data.size && state.chunks.push(e.data);
    state.recorder.start(1000);
    $("hud-rec").classList.remove("hidden");
    state.recordLimitId = setTimeout(() => {
      if (state.recorder && state.recorder.state === "recording") {
        state.recorder.stop();
        $("hud-rec").classList.add("hidden");
        NR.toast("توقف التسجيل بعد 3 دقائق للحفاظ على مساحة جهازك");
      }
    }, RECORD_LIMIT_MS);
  }

  function finishRecording() {
    clearTimeout(state.recordLimitId);
    const rec = state.recorder;
    state.recorder = null;
    $("hud-rec").classList.add("hidden");
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = () => resolve(state.chunks.length ? new Blob(state.chunks, { type: rec.mimeType || "video/webm" }) : null);
      if (rec.state === "inactive") return done();
      rec.onstop = done;
      rec.stop();
    });
  }

  // ---------------- البدء والإيقاف ----------------
  async function start() {
    $("btn-start").disabled = true;
    try {
      state.exerciseKey = $("exercise").value;
      state.counter = new RepCounter(EXERCISES[state.exerciseKey]);
      updateReps();
      updateLabels();
      await openCamera();
      await loadModel();

      state.running = true;
      state.startedAt = Date.now();
      tickTimer();
      state.timerId = setInterval(tickTimer, 500);
      $("btn-start").classList.add("hidden");
      $("btn-stop").classList.remove("hidden");
      $("exercise").disabled = true;
      $("record").disabled = true;

      if ("wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then((l) => (state.wakeLock = l)).catch(() => {});
      }

      if ($("record").checked && NR.currentUser()) startRecording();

      requestAnimationFrame(loop);
      await countdown();
      setFeedback("", EXERCISES[state.exerciseKey].positionMsg);
    } catch (err) {
      console.error(err);
      const msg = err && err.name === "NotAllowedError"
        ? "تم رفض إذن الكاميرا — اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح"
        : err && err.name === "NotFoundError"
          ? "لم يتم العثور على كاميرا في هذا الجهاز"
          : (err && err.message) || "حدث خطأ غير متوقع";
      setStageMsg(msg);
      setFeedback("bad", msg);
      stopStream();
      state.running = false;
    } finally {
      $("btn-start").disabled = false;
    }
  }

  async function stop() {
    if (!state.running) return;
    state.running = false;
    clearInterval(state.timerId);
    if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }

    const blob = await finishRecording();
    stopStream();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if ("speechSynthesis" in window) speechSynthesis.cancel();

    $("btn-stop").classList.add("hidden");
    $("btn-start").classList.remove("hidden");
    $("exercise").disabled = false;
    $("record").disabled = false;

    const duration = Math.round((Date.now() - state.startedAt) / 1000);
    const reps = state.counter.count;
    setStageMsg(`انتهت الجلسة: ${reps} تكرار في ${NR.fmtDuration(duration)}`);
    setFeedback("ok", reps ? "أحسنت! خذ قسطاً من الراحة واشرب ماء" : "جاهز");

    if (!NR.currentUser() || (reps === 0 && duration < 10)) return;

    const entry = {
      id: Date.now().toString(36),
      date: state.startedAt,
      exercise: state.exerciseKey,
      reps,
      good: state.counter.good,
      duration,
      video: false,
    };

    try {
      if (blob) {
        await NR.saveVideo(blob, {
          date: state.startedAt, exercise: state.exerciseKey, reps, duration, sessionId: entry.id,
        });
        entry.video = true;
      }
      const history = await NR.loadUserData("history", []);
      history.unshift(entry);
      await NR.saveUserData("history", history.slice(0, 500));
      NR.toast(blob ? "تم حفظ الجلسة والمقطع بشكل مشفّر" : "تم حفظ الجلسة في سجلك", "ok");
    } catch (err) {
      console.error(err);
      NR.toast("تعذّر حفظ الجلسة: " + err.message, "bad");
    }
  }

  // ---------------- الأحداث ----------------
  $("btn-start").addEventListener("click", start);
  $("btn-stop").addEventListener("click", stop);
  $("btn-reset").addEventListener("click", () => {
    if (state.counter) state.counter.reset();
    updateReps();
    setFeedback("", "تم تصفير العداد");
  });
  $("btn-flip").addEventListener("click", async () => {
    state.facing = state.facing === "user" ? "environment" : "user";
    if (!state.running) { NR.toast(state.facing === "user" ? "الكاميرا الأمامية" : "الكاميرا الخلفية"); return; }
    if (state.recorder) { NR.toast("أوقف الجلسة أولاً لتبديل الكاميرا أثناء التسجيل", "bad"); state.facing = state.facing === "user" ? "environment" : "user"; return; }
    try { await openCamera(); } catch (e) { NR.toast(e.message, "bad"); }
  });
  $("exercise").addEventListener("change", () => {
    state.exerciseKey = $("exercise").value;
    updateLabels();
    setFeedback("", EXERCISES[state.exerciseKey].positionMsg);
  });
  $("target").addEventListener("input", updateReps);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.running && "wakeLock" in navigator && !state.wakeLock) {
      navigator.wakeLock.request("screen").then((l) => (state.wakeLock = l)).catch(() => {});
    }
  });
  window.addEventListener("pagehide", () => { stopStream(); });

  // إعدادات محفوظة لكل متصفح
  const prefs = NR.store.get("nr_camera_prefs", {});
  if (prefs.exercise && EXERCISES[prefs.exercise]) $("exercise").value = prefs.exercise;
  if (prefs.target) $("target").value = prefs.target;
  if (typeof prefs.voice === "boolean") $("voice").checked = prefs.voice;
  ["exercise", "target", "voice"].forEach((id) =>
    $(id).addEventListener("change", () => NR.store.set("nr_camera_prefs", {
      exercise: $("exercise").value, target: $("target").value, voice: $("voice").checked,
    }))
  );

  if (!NR.currentUser()) {
    $("guest-note").classList.remove("hidden");
    $("record").checked = false;
    $("record").disabled = true;
    $("record").parentElement.title = "سجّل الدخول لتفعيل التسجيل";
  } else {
    NR.loadUserData("profile", {}).then((p) => {
      if (p.goal && !prefs.target) { $("target").value = p.goal; updateReps(); }
    });
  }

  state.exerciseKey = $("exercise").value;
  updateLabels();
  updateReps();
  setFeedback("", EXERCISES[state.exerciseKey].positionMsg);
})();
