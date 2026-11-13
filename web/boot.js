// Neuroport — "ESTABLISHING DATA LINK" screen on first launch (once per browser session).
// Wait for the first game state and preload the assets displayed by the app:
// contact avatars, map icons, vehicle images, Autofixer offers and the 3D map.
'use strict';

(() => {
  const BOOT_KEY = 'neuroport.booted';
  let booted = false;
  try { booted = sessionStorage.getItem(BOOT_KEY) === '1'; } catch { /* Storage is unavailable */ }
  const el = $('boot');
  if (booted || !el || !key) { if (el) el.remove(); return; }
  el.hidden = false;

  const steps = [
    { id: 'link', w: 1 }, { id: 'contacts', w: 2 }, { id: 'icons', w: 2 },
    { id: 'garage', w: 2 }, { id: 'map', w: 3 },
  ];
  const total = steps.reduce((n, s) => n + s.w, 0);
  let done = 0;
  const log = $('boot-log');
  const bar = $('boot-bar');
  const pct = $('boot-pct');

  function line(id, status) {
    let li = log.querySelector(`[data-s="${id}"]`);
    if (!li) {
      li = document.createElement('li');
      li.dataset.s = id;
      li.innerHTML = `<span class="bl-t"></span><b class="bl-s"></b>`;
      log.appendChild(li);
    }
    li.querySelector('.bl-t').textContent = t('boot_' + id);
    li.querySelector('.bl-s').textContent = status;
    li.className = status === 'OK' ? 'ok' : status === '—' ? 'skip' : 'run';
  }
  function progress(extra = 0) {
    const p = Math.min(100, Math.round(((done + extra) / total) * 100));
    bar.style.width = p + '%';
    pct.textContent = String(p).padStart(3, '0') + '%';
  }

  // Load images in parallel (up to six at a time), with a timeout.
  function preload(urls, w, timeout = 9000) {
    urls = [...new Set(urls.filter(Boolean))];
    if (!urls.length) return Promise.resolve();
    let ok = 0, i = 0;
    return new Promise((resolve) => {
      const end = setTimeout(resolve, timeout);
      const next = () => {
        if (i >= urls.length) return;
        const img = new Image();
        img.onload = img.onerror = () => {
          ok++;
          progress((ok / urls.length) * w);
          if (ok >= urls.length) { clearTimeout(end); resolve(); } else next();
        };
        img.src = urls[i++];
      };
      for (let k = 0; k < Math.min(6, urls.length); k++) next();
    });
  }
  const until = (fn, timeout) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (!$('pair').hidden) { el.remove(); return; }          // Invalid code: the pairing screen takes over.
      if (fn() || performance.now() - t0 > timeout) resolve(fn()); else setTimeout(tick, 120);
    };
    tick();
  });
  const imgUrl = (o) => (o && o.img && o.img.part ? `avatar/${encodeURIComponent(o.img.part)}.png${o.img.atlas ? `?a=${encodeURIComponent(o.img.atlas)}` : ''}` : null);

  async function run() {
    // 1. Initial game state.
    line('link', '…');
    const got = await until(() => typeof state !== 'undefined' && state, 15000);
    const g = got ? game() : {};
    const inGame = got && state.online && g && g.inGame;
    line('link', got ? 'OK' : 'ERR');
    done += 1; progress();

    // 2. Contacts (avatars).
    line('contacts', '…');
    if (inGame) {
      const av = (g.contacts || []).filter((c) => c.avatar)
        .map((c) => `avatar/${encodeURIComponent(c.avatar)}.png${c.atlas ? `?a=${encodeURIComponent(c.atlas)}` : ''}`);
      await preload(av, 2, 30000);
      line('contacts', `${(g.contacts || []).length} OK`.replace(/^0 OK$/, 'OK'));
    } else line('contacts', '—');
    done += 2; progress();

    // 3. Map and app icons.
    line('icons', '…');
    const icons = Object.keys(typeof FILTER_BY_VARIANT === 'object' ? FILTER_BY_VARIANT : {}).map((v) => `mapicons/${v}.png`);
    icons.push('icons/autofixer.png', 'icons/autofixer_wide.png');
    await preload(icons, 2);
    if (typeof mapIconImage === 'function') for (const v of Object.keys(FILTER_BY_VARIANT)) mapIconImage(v);
    line('icons', 'OK');
    done += 2; progress();

    // 4. Garage, Autofixer and El Capitan: wait for the server to extract the game images.
    line('garage', '…');
    if (inGame) {
      const t0 = performance.now();
      for (;;) {
        let w = null;
        try { w = await (await fetch(`/api/warm?k=${encodeURIComponent(key)}`, { cache: 'no-store' })).json(); } catch { /* servidor antigo */ }
        if (!w || !w.total) break;
        line('garage', `${w.done}/${w.total}`);
        progress(Math.min(1, w.done / w.total) * 1.2);
        if (w.done >= w.total || performance.now() - t0 > 240000) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      const g2 = game() || g;
      await preload([...(g2.vehicles || []).map(imgUrl), ...(g2.offers || []).map(imgUrl)], 0.8, 30000);
      line('garage', 'OK');
    } else line('garage', '—');
    done += 2; progress();

    // 5. 3D map (city model).
    line('map', '…');
    let mapState = window.Map3D && Map3D.ready ? 'ok' : null;
    if (!mapState) {
      mapState = await new Promise((resolve) => {
        const end = setTimeout(() => resolve('slow'), 20000);
        const fake = setInterval(() => progress(Math.min(2.6, (performance.now() - t0) / 4000)), 200);
        const t0 = performance.now();
        const fin = (v) => { clearTimeout(end); clearInterval(fake); resolve(v); };
        window.addEventListener('map3d-ready', () => fin('ok'), { once: true });
        window.addEventListener('map3d-error', () => fin('err'), { once: true });
      });
    }
    line('map', mapState === 'ok' ? 'OK' : mapState === 'err' ? 'ERR' : '…');
    done += 3; progress();

    $('boot-title').textContent = t('bootReady');
    try { sessionStorage.setItem(BOOT_KEY, '1'); } catch { /* ok */ }
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }, 380);
  }
  // Skip: tap the screen after a few seconds.
  setTimeout(() => { const skip = $('boot-skip'); if (skip) skip.hidden = false; }, 4000);
  $('boot-skip').addEventListener('click', () => {
    try { sessionStorage.setItem(BOOT_KEY, '1'); } catch { /* ok */ }
    el.classList.add('out');
    setTimeout(() => el.remove(), 450);
  });
  run();
})();
