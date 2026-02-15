// ---------------- تسجيل الدخول البسيط ----------------
function login() {
    // هنا ممكن لاحقاً تضيفين تحقق حقيقي
    alert("تم تسجيل الدخول (نموذج تجريبي)");
    window.location.href = "index.html";
}

// ---------------- التشفير باستخدام AES (CryptoJS) ----------------
const SECRET_KEY = "SmartFitGuardEncryptionKey2025";

// تشفير نص
function encryptData(data) {
    if (typeof CryptoJS === "undefined") return data;
    return CryptoJS.AES.encrypt(data, SECRET_KEY).toString();
}

// فك التشفير
function decryptData(ciphertext) {
    if (typeof CryptoJS === "undefined") return ciphertext;
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

// حفظ الملف الشخصي بشكل مشفر
function saveProfile() {
    const name = document.getElementById("name").value;
    const age = document.getElementById("age").value;
    const height = document.getElementById("height").value;
    const weight = document.getElementById("weight").value;

    const profile = JSON.stringify({ name, age, height, weight });
    const encrypted = encryptData(profile);

    localStorage.setItem("user_profile", encrypted);

    alert("تم حفظ البيانات بشكل مشفر وآمن");
}

// تحميل الملف الشخصي عند فتح الصفحة
function loadProfile() {
    const encrypted = localStorage.getItem("user_profile");
    if (!encrypted) return;

    const decrypted = decryptData(encrypted);
    if (!decrypted) return;

    const profile = JSON.parse(decrypted);

    document.getElementById("name").value = profile.name || "";
    document.getElementById("age").value = profile.age || "";
    document.getElementById("height").value = profile.height || "";
    document.getElementById("weight").value = profile.weight || "";
}

// ---------------- إعدادات الكاميرا + الذكاء الاصطناعي ----------------
let video = null;
let canvas = null;
let ctx = null;
let detector = null;
let isDetecting = false;

let counter = 0;
let stage = null;
let feedbackText = "جاهز";
let color = "green";

const UP_THRESHOLD = 160;
const DOWN_THRESHOLD = 100;
const BACK_THRESHOLD = 130;

// تشغيل الكاميرا
async function startCamera() {
    if (isDetecting) return;

    video = document.getElementById("camera");
    canvas = document.getElementById("overlay");
    if (!video || !canvas) return;

    ctx = canvas.getContext("2d");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;

        video.onloadedmetadata = async () => {
            video.play();
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const statusEl = document.getElementById("status");
            if (statusEl) statusEl.innerText = "الحالة: الكاميرا تعمل";

            await loadModel();
            startDetection();
        };
    } catch (err) {
        alert("لا يمكن تشغيل الكاميرا: " + err.message);
    }
}

// تحميل نموذج MoveNet
async function loadModel() {
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.innerText = "الحالة: جاري تحميل نموذج الذكاء الاصطناعي...";

    await tf.setBackend('webgl');

    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
        }
    );

    if (statusEl) statusEl.innerText = "الحالة: النموذج جاهز، جاري التتبع...";
}

// بدء التتبع
function startDetection() {
    isDetecting = true;
    detectPose();
}

// حساب الزاوية بين ثلاث نقاط (مثل كود Python)
function calculateAngle(a, b, c) {
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;
    const cx = c.x;
    const cy = c.y;

    const angle = Math.atan2(cy - by, cx - bx) - Math.atan2(ax - bx, ay - by);
    let degrees = Math.abs(angle * (180.0 / Math.PI));
    if (degrees > 180) {
        degrees = 360 - degrees;
    }
    return degrees;
}

// جلب نقطة باسمها من keypoints
function getPoint(keypoints, name) {
    const kp = keypoints.find(k => k.name === name || k.part === name);
    if (!kp) return null;
    return { x: kp.x, y: kp.y, score: kp.score };
}

// حلقة التتبع
async function detectPose() {
    if (!isDetecting || !detector || !video) return;

    const poses = await detector.estimatePoses(video);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (poses && poses.length > 0) {
        const pose = poses[0];
        const keypoints = pose.keypoints;

        const shoulder = getPoint(keypoints, "right_shoulder") || getPoint(keypoints, "left_shoulder");
        const hip = getPoint(keypoints, "right_hip") || getPoint(keypoints, "left_hip");
        const knee = getPoint(keypoints, "right_knee") || getPoint(keypoints, "left_knee");
        const ankle = getPoint(keypoints, "right_ankle") || getPoint(keypoints, "left_ankle");

        if (shoulder && hip && knee && ankle) {
            // رسم النقاط
            drawPoint(shoulder, "white");
            drawPoint(hip, "white");
            drawPoint(knee, "white");
            drawPoint(ankle, "white");

            // رسم الخطوط
            drawLine(shoulder, hip, "white");
            drawLine(hip, knee, "white");
            drawLine(knee, ankle, "white");

            // حساب الزوايا
            const kneeAngle = calculateAngle(hip, knee, ankle);
            const backAngle = calculateAngle(shoulder, hip, knee);

            // منطق التقييم
            if (backAngle < BACK_THRESHOLD) {
                feedbackText = "حافظ على استقامة ظهرك!";
                color = "red";
            } else {
                if (kneeAngle > UP_THRESHOLD) {
                    stage = "up";
                    feedbackText = "جاهز للنزول";
                    color = "green";
                } else if (kneeAngle < DOWN_THRESHOLD && stage === "up") {
                    stage = "down";
                    counter += 1;
                    feedbackText = "سكوات ممتاز!";
                    color = "green";
                }
            }

            // عرض الأرقام على الكانفس
            ctx.fillStyle = "yellow";
            ctx.font = "20px Tahoma";
            ctx.fillText(`Knee: ${Math.round(kneeAngle)}`, 10, 30);
            ctx.fillText(`Back: ${Math.round(backAngle)}`, 10, 60);
        }
    }

    // تحديث النصوص في الصفحة
    const counterEl = document.getElementById("counter");
    const feedbackEl = document.getElementById("feedback");

    if (counterEl) counterEl.innerText = `العدّات: ${counter}`;
    if (feedbackEl) {
        feedbackEl.innerText = `التغذية الراجعة: ${feedbackText}`;
        feedbackEl.style.color = color;
    }

    requestAnimationFrame(detectPose);
}

// رسم نقطة
function drawPoint(point, color) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
}

// رسم خط
function drawLine(a, b, color) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
}