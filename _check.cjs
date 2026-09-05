const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w,h] of [[900,900],[390,844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    for (const f of ['hari-14.html','index.html']) {
      await p.goto('file:///home/user/jurnal-eropa/'+f, { waitUntil: 'load' });
      for (let y=0; y<110; y++) { await p.mouse.wheel(0, 1400); await p.waitForTimeout(45); }
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => ({
        broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
        pending: [...document.images].filter(i => !i.complete).length,
        total: document.images.length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      console.log(w+'px', f, JSON.stringify(r));
    }
    await p.close();
  }
  await b.close();
})();
