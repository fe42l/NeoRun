/* =====================================================================
   NeoRun — منطق التمارين (مستقل عن الواجهة، قابل للاختبار)
   ===================================================================== */
(function (root) {
  "use strict";

  const MIN_SCORE = 0.3;

  // الزاوية عند النقطة b بين المستقيمين b→a و b→c (0–180)
  function angle(a, b, c) {
    const r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs((r * 180) / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return deg;
  }

  // ميل المستقيم (من bottom إلى top) عن الخط العمودي (0 = عمودي تماماً)
  function leanFromVertical(top, bottom) {
    const dx = top.x - bottom.x;
    const dy = bottom.y - top.y; // محور y في الصورة للأسفل
    return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
  }

  // تحويل keypoints إلى خريطة بالاسم مع تجاهل النقاط ضعيفة الثقة
  function toMap(keypoints) {
    const map = {};
    for (const k of keypoints || []) {
      if (k && k.name && (k.score ?? 1) >= MIN_SCORE) map[k.name] = k;
    }
    return map;
  }

  // اختيار الجهة (يمين/يسار) الأوضح للكاميرا
  function sidePoints(map, joints) {
    let best = null;
    for (const side of ["left", "right"]) {
      const p = {};
      let total = 0;
      let ok = true;
      for (const j of joints) {
        const k = map[`${side}_${j}`];
        if (!k) { ok = false; break; }
        p[j] = k;
        total += k.score ?? 1;
      }
      if (ok && (!best || total > best.score)) best = { side, p, score: total };
    }
    return best;
  }

  function bothSides(map, joints) {
    const out = {};
    for (const side of ["left", "right"]) {
      out[side] = {};
      for (const j of joints) {
        const k = map[`${side}_${j}`];
        if (!k) return null;
        out[side][j] = k;
      }
    }
    return out;
  }

  const EXERCISES = {
    squat: {
      name: "سكوات",
      mainLabel: "زاوية الركبة",
      formLabel: "ميل الجذع",
      startAbove: true, // وضع البداية: زاوية كبيرة (واقف)
      startT: 160,
      peakT: 100,
      startMsg: "انزل ببطء مع إبقاء صدرك مرفوعاً",
      peakMsg: "ممتاز! الآن اصعد",
      shallowMsg: "انزل أكثر حتى يصبح فخذك موازياً للأرض",
      positionMsg: "قف بشكل جانبي للكاميرا وأظهر جسمك كاملاً",
      measure(map) {
        const s = sidePoints(map, ["shoulder", "hip", "knee", "ankle"]);
        if (!s) return null;
        const { p } = s;
        return {
          main: angle(p.hip, p.knee, p.ankle),
          form: leanFromVertical(p.shoulder, p.hip),
          joints: [p.shoulder, p.hip, p.knee, p.ankle],
        };
      },
      check(m) {
        if (m.form > 50) return "ارفع صدرك وحافظ على استقامة ظهرك";
        return null;
      },
    },

    pushup: {
      name: "ضغط",
      mainLabel: "زاوية الكوع",
      formLabel: "استقامة الجسم",
      startAbove: true,
      startT: 150,
      peakT: 95,
      startMsg: "انزل بصدرك نحو الأرض",
      peakMsg: "رائع! ادفع للأعلى",
      shallowMsg: "انزل أكثر حتى يصبح الكوع بزاوية قائمة",
      positionMsg: "ضع الكاميرا بجانبك وأظهر جسمك من الكتف إلى الكاحل",
      measure(map) {
        const s = sidePoints(map, ["shoulder", "elbow", "wrist", "hip", "ankle"]);
        if (!s) return null;
        const { p } = s;
        return {
          main: angle(p.shoulder, p.elbow, p.wrist),
          form: angle(p.shoulder, p.hip, p.ankle),
          joints: [p.wrist, p.elbow, p.shoulder, p.hip, p.ankle],
        };
      },
      check(m) {
        if (m.form < 150) return "حافظ على جسمك مستقيماً — لا ترفع الورك ولا تُنزله";
        return null;
      },
    },

    armraise: {
      name: "رفع الذراعين",
      mainLabel: "زاوية الكتف",
      formLabel: "فرق الجهتين",
      startAbove: false, // وضع البداية: الذراعان للأسفل (زاوية صغيرة)
      startT: 30,
      peakT: 80,
      startMsg: "ارفع ذراعيك جانباً حتى مستوى الكتف",
      peakMsg: "ممتاز! أنزل ذراعيك ببطء",
      shallowMsg: "ارفع أكثر حتى مستوى الكتفين",
      positionMsg: "قف مقابل الكاميرا وأظهر ذراعيك ووركيك",
      measure(map) {
        const b = bothSides(map, ["shoulder", "elbow", "wrist", "hip"]);
        if (!b) return null;
        const l = angle(b.left.hip, b.left.shoulder, b.left.elbow);
        const r = angle(b.right.hip, b.right.shoulder, b.right.elbow);
        const elbow = Math.min(
          angle(b.left.shoulder, b.left.elbow, b.left.wrist),
          angle(b.right.shoulder, b.right.elbow, b.right.wrist)
        );
        return {
          main: (l + r) / 2,
          form: Math.abs(l - r),
          elbow,
          joints: [
            b.left.wrist, b.left.elbow, b.left.shoulder, b.left.hip,
            b.right.wrist, b.right.elbow, b.right.shoulder, b.right.hip,
          ],
        };
      },
      check(m) {
        if (m.form > 25) return "ارفع الذراعين بالتساوي";
        if (m.main > 45 && m.elbow < 140) return "مدّ ذراعيك ولا تثنِ الكوع";
        return null;
      },
    },
  };

  /* عدّاد التكرارات — آلة حالات:
     idle → (وضع البداية) → start → (أقصى نقطة) → peak → (العودة للبداية) → عدّة جديدة */
  class RepCounter {
    constructor(exercise, smoothing = 0.45) {
      this.ex = exercise;
      this.alpha = smoothing;
      this.reset();
    }

    reset() {
      this.count = 0;
      this.good = 0;
      this.phase = "idle";
      this.descending = false;
      this.repFault = false;
      this.smooth = null;
    }

    _inStart(a) { return this.ex.startAbove ? a >= this.ex.startT : a <= this.ex.startT; }
    _atPeak(a) { return this.ex.startAbove ? a <= this.ex.peakT : a >= this.ex.peakT; }
    _depth(a) { return (this.ex.startT - a) / (this.ex.startT - this.ex.peakT); }

    /** @returns {{event: string|null, level: string, msg: string, main: number, form: number}} */
    update(m) {
      if (!m) {
        return { event: "lost", level: "warn", msg: this.ex.positionMsg, main: NaN, form: NaN };
      }

      if (!this.smooth) this.smooth = { main: m.main, form: m.form };
      else {
        this.smooth.main += this.alpha * (m.main - this.smooth.main);
        this.smooth.form += this.alpha * (m.form - this.smooth.form);
      }
      const sm = { ...m, main: this.smooth.main, form: this.smooth.form };
      const a = sm.main;
      let event = null;
      let level = "ok";
      let msg = "";

      if (this.phase === "idle") {
        if (this._inStart(a)) {
          this.phase = "start";
          msg = this.ex.startMsg;
        } else {
          return { event: null, level: "warn", msg: "اتخذ وضعية البداية", main: a, form: sm.form };
        }
      } else if (this.phase === "start") {
        if (this._atPeak(a)) {
          this.phase = "peak";
          this.descending = false;
          msg = this.ex.peakMsg;
          event = "peak";
        } else if (this._depth(a) > 0.35) {
          this.descending = true;
          msg = this.ex.startMsg;
        } else if (this.descending && this._inStart(a)) {
          this.descending = false;
          this.repFault = false;
          event = "partial";
          level = "warn";
          msg = this.ex.shallowMsg;
        } else {
          msg = this.ex.startMsg;
        }
      } else if (this.phase === "peak") {
        if (this._inStart(a)) {
          this.phase = "start";
          this.count += 1;
          if (!this.repFault) this.good += 1;
          event = "rep";
          msg = this.repFault ? "تم العدّ — انتبه لوضعيتك في المرة القادمة" : "تكرار ممتاز!";
          level = this.repFault ? "warn" : "ok";
          this.repFault = false;
        } else {
          msg = this.ex.peakMsg;
        }
      }

      if (this.phase !== "idle" && event !== "rep") {
        const fault = this.ex.check(sm);
        if (fault) {
          this.repFault = true;
          level = "bad";
          msg = fault;
        }
      }

      return { event, level, msg, main: a, form: sm.form };
    }
  }

  const api = { EXERCISES, RepCounter, angle, leanFromVertical, toMap, MIN_SCORE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NRExercise = api;
})(typeof window !== "undefined" ? window : globalThis);
