// Neuroport — incoming call ringtone.
// Plays the game's own ringtone (ringtone/ringtone.ogg, extracted from the installation)
// through the Web Audio API. It does not use <audio>: on Android, an audio element becomes
// Media session integration can let the operating system (Bluetooth headset or notification) play it.
// audible on its own. With Web Audio, the ringtone plays only when requested by the app.
'use strict';

const Ringtone = (() => {
  let ctx = null, buffer = null, loading = null, failed = false;
  let src = null, ringing = false, synthTimer = null, vibeTimer = null;

  function audioCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  function load() {
    if (buffer || failed || loading || !audioCtx()) return loading;
    loading = fetch('ringtone/ringtone.ogg')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((b) => { buffer = b; })
      .catch(() => { failed = true; })
      .finally(() => { loading = null; });
    return loading;
  }

  // Browsers allow audio playback only after a user gesture.
  function unlock() {
    const c = audioCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    load();
  }
  document.addEventListener('pointerdown', unlock, { capture: true });

  function synthBurst() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i % 2 ? 1180 : 1560;
      const t = t0 + i * 0.13;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.01);
      g.gain.setValueAtTime(0.08, t + 0.1);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.13);
    }
  }

  function playBuffer() {
    if (!ringing || src || !buffer) return;
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
  }

  function start() {
    if (ringing) return;
    ringing = true;
    const c = audioCtx();
    if (c) {
      if (c.state === 'suspended') c.resume();
      if (buffer) playBuffer();
      else if (!failed) {
        const p = load();
        if (p) p.then(() => { if (!ringing) return; if (buffer) playBuffer(); else { synthBurst(); synthTimer = setInterval(synthBurst, 1800); } });
      } else { synthBurst(); synthTimer = setInterval(synthBurst, 1800); }
    }
    const vibe = () => { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch { /* ok */ } };
    vibe();
    vibeTimer = setInterval(vibe, 2000);
  }

  // Always clean up, even if playback appears to have already stopped.
  function stop() {
    ringing = false;
    if (src) { try { src.stop(); } catch { /* ok */ } try { src.disconnect(); } catch { /* ok */ } src = null; }
    clearInterval(synthTimer); synthTimer = null;
    clearInterval(vibeTimer); vibeTimer = null;
    try { navigator.vibrate && navigator.vibrate(0); } catch { /* ok */ }
  }

  return { start, stop, unlock, get ringing() { return ringing; } };
})();
