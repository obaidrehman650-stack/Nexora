/* ════════════════════════════════════════════════════════════
   NEXORA — Dashboard chart primitives
   Lightweight, dependency-free SVG charts with scroll-in
   animations. All sized via viewBox so they scale.
══════════════════════════════════════════════════════════════ */

const NX = (() => {
  /* ── Easings ── */
  const ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outQuart: t => 1 - Math.pow(1 - t, 4),
    outQuint: t => 1 - Math.pow(1 - t, 5),
  };

  /* ── Animation helper ── */
  function tween(duration, onUpdate, onDone, easing = ease.outCubic) {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      onUpdate(easing(t));
      if (t < 1) requestAnimationFrame(frame);
      else if (onDone) onDone();
    }
    requestAnimationFrame(frame);
  }

  /* ── Counter animation ── */
  function animateCounter(el, target, opts = {}) {
    const dur = opts.duration || 1100;
    const prefix = opts.prefix || '';
    const suffix = opts.suffix || '';
    const decimals = opts.decimals || 0;
    const sep = opts.sep === undefined ? true : opts.sep;
    function fmt(n) {
      n = decimals ? n.toFixed(decimals) : Math.round(n).toString();
      if (sep && !decimals) n = parseInt(n, 10).toLocaleString('en-US');
      return prefix + n + suffix;
    }
    tween(dur, (t) => {
      el.textContent = fmt(target * t);
    }, () => { el.textContent = fmt(target); });
  }

  /* ── Smooth path generator (Catmull-Rom → Bezier) ── */
  function smoothPath(points) {
    if (points.length < 2) return '';
    const path = [`M ${points[0][0]} ${points[0][1]}`];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      path.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
    }
    return path.join(' ');
  }

  /* ──────────────────────────────────────────────
     AREA / LINE chart
     opts: { width, height, data: [{label,value}], color, gridY?, smooth?, label? }
  ─────────────────────────────────────────────── */
  function areaChart(el, opts) {
    const W = opts.width || 720;
    const H = opts.height || 240;
    const padL = 36, padR = 18, padT = 14, padB = 28;
    const data = opts.data;
    const color = opts.color || 'var(--accent)';
    const max = Math.max(...data.map(d => d.value)) * 1.15;
    const min = Math.min(0, ...data.map(d => d.value));
    const sw = W - padL - padR;
    const sh = H - padT - padB;

    const points = data.map((d, i) => [
      padL + (sw * i) / (data.length - 1),
      padT + sh - ((d.value - min) / (max - min)) * sh,
    ]);

    const gridLines = 4;
    const gridY = [];
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (sh * i) / gridLines;
      const v = max - ((max - min) * i) / gridLines;
      gridY.push({ y, v });
    }

    const line = opts.smooth ? smoothPath(points) : points.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p[0] + ' ' + p[1]).join(' ');
    const area = line + ` L ${points[points.length - 1][0]} ${padT + sh} L ${points[0][0]} ${padT + sh} Z`;

    el.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaG-${el.id || 'x'}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stop-color="${color}" stop-opacity="0.28"></stop>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
          </linearGradient>
        </defs>
        ${gridY.map(g => `
          <line x1="${padL}" x2="${W - padR}" y1="${g.y}" y2="${g.y}"
                stroke="var(--rule)" stroke-width="1"
                stroke-dasharray="${g.y === padT + sh ? '' : '3 4'}"></line>
          <text x="${padL - 8}" y="${g.y + 3}" text-anchor="end"
                fill="var(--text-muted)" font-size="10"
                font-family="JetBrains Mono, monospace">${formatVal(g.v, opts.unit)}</text>
        `).join('')}
        <path d="${area}" fill="url(#areaG-${el.id || 'x'})"
              style="clip-path: inset(0 100% 0 0); transition: clip-path 1.2s cubic-bezier(0.22,1,0.36,1);"
              class="chart-area"></path>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              stroke-dasharray="2000" stroke-dashoffset="2000" class="chart-line"></path>
        ${points.map((p, i) => `
          <g class="chart-dot" style="opacity:0; transition: opacity 0.3s ${0.6 + i*0.04}s ease;">
            <circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}"></circle>
            <circle cx="${p[0]}" cy="${p[1]}" r="1.5" fill="#fff"></circle>
          </g>
        `).join('')}
        ${data.map((d, i) => `
          <text x="${points[i][0]}" y="${H - 8}" text-anchor="middle"
                fill="var(--text-muted)" font-size="10"
                font-family="Inter, sans-serif">${d.label}</text>
        `).join('')}
      </svg>
    `;

    // Animate on intersect
    onceInView(el, () => {
      const path = el.querySelector('.chart-line');
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(0.22,1,0.36,1)';
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = '0';
        el.querySelector('.chart-area').style.clipPath = 'inset(0 0 0 0)';
        el.querySelectorAll('.chart-dot').forEach(d => d.style.opacity = 1);
      });
    });
  }

  /* ──────────────────────────────────────────────
     STACKED AREA chart
     opts: { width, height, data: [{label, surgical, sports, leather}] }
  ─────────────────────────────────────────────── */
  function stackedArea(el, opts) {
    const W = opts.width || 720;
    const H = opts.height || 260;
    const padL = 36, padR = 18, padT = 14, padB = 28;
    const data = opts.data;
    const keys = opts.keys || ['surgical', 'sports', 'leather'];
    const colors = opts.colors || ['var(--ind-surgical)', 'var(--ind-sports)', 'var(--ind-leather)'];
    const sw = W - padL - padR;
    const sh = H - padT - padB;

    // Compute stacks
    const stacks = data.map(row => {
      let acc = 0;
      return keys.map(k => { const a = acc; acc += row[k]; return [a, acc]; });
    });
    const max = Math.max(...stacks.map(s => s[s.length - 1][1])) * 1.10;

    const xAt = (i) => padL + (sw * i) / (data.length - 1);
    const yAt = (v) => padT + sh - (v / max) * sh;

    const gridLines = 4;
    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (sh * i) / gridLines;
      const v = max - (max * i) / gridLines;
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule)" stroke-width="1" stroke-dasharray="${i === gridLines ? '' : '3 4'}"></line>
              <text x="${padL - 8}" y="${y + 3}" text-anchor="end" fill="var(--text-muted)" font-size="10" font-family="JetBrains Mono, monospace">${Math.round(v)}</text>`;
    }

    // Layer per key from top-down so colors stack visually (paint deepest first)
    keys.forEach((k, ki) => {
      const top = data.map((_, i) => [xAt(i), yAt(stacks[i][ki][1])]);
      const bot = data.map((_, i) => [xAt(i), yAt(stacks[i][ki][0])]).reverse();
      const path = [...top, ...bot]
        .map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p[0] + ' ' + p[1]).join(' ') + ' Z';
      svg += `<path d="${path}" fill="${colors[ki]}" opacity="0.86"
                style="clip-path: inset(0 100% 0 0); transition: clip-path 1.2s cubic-bezier(0.22,1,0.36,1) ${ki*0.12}s;"
                class="stack-layer"></path>`;
    });

    // X labels
    data.forEach((d, i) => {
      svg += `<text x="${xAt(i)}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="Inter, sans-serif">${d.label}</text>`;
    });

    svg += `</svg>`;
    el.innerHTML = svg;
    onceInView(el, () => {
      el.querySelectorAll('.stack-layer').forEach(l => l.style.clipPath = 'inset(0 0 0 0)');
    });
  }

  /* ──────────────────────────────────────────────
     DONUT chart (industry breakdown)
     opts: { size, data: [{label, value, color}], thickness? }
  ─────────────────────────────────────────────── */
  function donut(el, opts) {
    const S = opts.size || 220;
    const cx = S / 2, cy = S / 2;
    const r = S / 2 - 18;
    const thick = opts.thickness || 22;
    const ri = r - thick;
    const data = opts.data;
    const total = data.reduce((a, b) => a + b.value, 0);

    let a0 = -Math.PI / 2;
    const segs = data.map(d => {
      const ang = (d.value / total) * Math.PI * 2;
      const a1 = a0 + ang;
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const x2 = cx + Math.cos(a1) * ri, y2 = cy + Math.sin(a1) * ri;
      const x3 = cx + Math.cos(a0) * ri, y3 = cy + Math.sin(a0) * ri;
      const large = ang > Math.PI ? 1 : 0;
      const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 ${large} 0 ${x3} ${y3} Z`;
      a0 = a1;
      return { path, ...d };
    });

    el.innerHTML = `
      <svg class="chart-svg donut-svg" viewBox="0 0 ${S} ${S}">
        <circle cx="${cx}" cy="${cy}" r="${(r+ri)/2}" fill="none" stroke="var(--bg-elevated)" stroke-width="${thick}"></circle>
        ${segs.map((s, i) => `
          <path d="${s.path}" fill="${s.color}"
                style="opacity:0; transform-origin:${cx}px ${cy}px; transform:scale(0.85) rotate(-8deg); transition: all 0.7s cubic-bezier(0.22,1,0.36,1) ${i*0.12}s;"
                class="donut-seg"></path>
        `).join('')}
        <text x="${cx}" y="${cy - 6}" text-anchor="middle"
              fill="var(--text)" font-family="Fraunces, serif"
              font-size="${S * 0.18}" font-weight="400"
              style="font-variation-settings: 'opsz' 144, 'SOFT' 80;">${opts.centerValue || total}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle"
              fill="var(--text-muted)" font-family="Inter, sans-serif"
              font-size="10" letter-spacing="2" style="text-transform: uppercase;">${opts.centerLabel || 'Total'}</text>
      </svg>
    `;
    onceInView(el, () => {
      el.querySelectorAll('.donut-seg').forEach(p => {
        p.style.opacity = 1;
        p.style.transform = 'scale(1) rotate(0deg)';
      });
    });
  }

  /* ──────────────────────────────────────────────
     BAR chart (horizontal)
     opts: { data: [{label, value, color?}], formatter? }
  ─────────────────────────────────────────────── */
  function barH(el, opts) {
    const data = opts.data;
    const max = Math.max(...data.map(d => d.value));
    const fmt = opts.formatter || (v => v.toLocaleString());
    el.innerHTML = data.map((d, i) => `
      <div class="bar-row" style="display:grid;grid-template-columns:120px 1fr 70px;gap:14px;align-items:center;padding:9px 0;border-bottom:1px dashed var(--rule);">
        <div style="font-size:0.86rem;color:var(--text);font-weight:450;display:flex;align-items:center;gap:8px;">${d.icon || ''}${d.label}</div>
        <div style="position:relative;height:8px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
          <span style="position:absolute;left:0;top:0;bottom:0;width:${(d.value/max)*100}%;background:${d.color || 'var(--accent)'};border-radius:3px;transform-origin:left;transform:scaleX(0);transition:transform 0.9s cubic-bezier(0.22,1,0.36,1) ${i*0.08}s;" class="bar-fill"></span>
        </div>
        <div style="font-family:var(--font-mono);font-size:0.82rem;text-align:right;color:var(--text);">${fmt(d.value)}</div>
      </div>
    `).join('');
    el.lastElementChild && (el.lastElementChild.style.borderBottom = '0');
    onceInView(el, () => {
      el.querySelectorAll('.bar-fill').forEach(b => b.style.transform = 'scaleX(1)');
    });
  }

  /* ──────────────────────────────────────────────
     COLUMN chart (vertical bars, multi-series)
     opts: { width, height, data: [{label, a, b}], series:[{key,color,label}] }
  ─────────────────────────────────────────────── */
  function columns(el, opts) {
    const W = opts.width || 720;
    const H = opts.height || 240;
    const padL = 36, padR = 16, padT = 14, padB = 28;
    const data = opts.data;
    const series = opts.series;
    const sw = W - padL - padR;
    const sh = H - padT - padB;
    const groupW = sw / data.length;
    const barW = (groupW - 18) / series.length;
    const max = Math.max(...data.flatMap(d => series.map(s => d[s.key]))) * 1.15;

    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (sh * i) / gridLines;
      const v = max - (max * i) / gridLines;
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule)" stroke-width="1" stroke-dasharray="${i === gridLines ? '' : '3 4'}"></line>
              <text x="${padL - 8}" y="${y + 3}" text-anchor="end" fill="var(--text-muted)" font-size="10" font-family="JetBrains Mono, monospace">${formatVal(v, opts.unit)}</text>`;
    }
    data.forEach((d, i) => {
      const x0 = padL + i * groupW + 9;
      series.forEach((s, si) => {
        const h = (d[s.key] / max) * sh;
        const x = x0 + si * barW;
        svg += `<rect x="${x}" y="${padT + sh}" width="${barW - 3}" height="0" fill="${s.color}" rx="2"
                  data-target-y="${padT + sh - h}" data-target-h="${h}" class="col-bar"
                  style="transform-origin:bottom; transition: y 0.9s cubic-bezier(0.22,1,0.36,1) ${i*0.04 + si*0.06}s, height 0.9s cubic-bezier(0.22,1,0.36,1) ${i*0.04 + si*0.06}s;"></rect>`;
      });
      svg += `<text x="${padL + i * groupW + groupW/2}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="Inter, sans-serif">${d.label}</text>`;
    });
    svg += `</svg>`;
    el.innerHTML = svg;
    onceInView(el, () => {
      el.querySelectorAll('.col-bar').forEach(b => {
        b.setAttribute('y', b.dataset.targetY);
        b.setAttribute('height', b.dataset.targetH);
      });
    });
  }

  /* ──────────────────────────────────────────────
     SPARKLINE (inline, for tables/KPI)
  ─────────────────────────────────────────────── */
  function sparkline(values, opts = {}) {
    const W = opts.width || 90, H = opts.height || 28;
    const max = Math.max(...values), min = Math.min(...values);
    const pts = values.map((v, i) => [
      (W * i) / (values.length - 1),
      H - 2 - ((v - min) / (max - min || 1)) * (H - 4)
    ]);
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p[0] + ' ' + p[1]).join(' ');
    const areaPath = path + ` L ${pts[pts.length-1][0]} ${H} L 0 ${H} Z`;
    const color = opts.color || 'var(--accent)';
    return `
      <svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${areaPath}" class="area" fill="${color}" opacity="0.16"></path>
        <path d="${path}" class="line" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="2.4" fill="${color}"></circle>
      </svg>
    `;
  }

  /* ──────────────────────────────────────────────
     RADIAL (gauge)
     opts: { size, value(0-1), color, label, sub }
  ─────────────────────────────────────────────── */
  function gauge(el, opts) {
    const S = opts.size || 160;
    const r = S / 2 - 14;
    const cx = S / 2, cy = S / 2;
    const circ = 2 * Math.PI * r;
    const color = opts.color || 'var(--accent)';
    el.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${S} ${S}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-elevated)" stroke-width="10"></circle>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
                stroke-linecap="round"
                stroke-dasharray="${circ}"
                stroke-dashoffset="${circ}"
                transform="rotate(-90 ${cx} ${cy})"
                class="gauge-arc"
                style="transition: stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1);"></circle>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="var(--text)"
              font-family="Fraunces, serif" font-size="${S*0.22}" font-weight="400">${Math.round(opts.value * 100)}%</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="var(--text-muted)"
              font-size="10" letter-spacing="1.5" style="text-transform: uppercase;">${opts.label || ''}</text>
      </svg>
    `;
    onceInView(el, () => {
      el.querySelector('.gauge-arc').style.strokeDashoffset = circ * (1 - opts.value);
    });
  }

  /* ──────────────────────────────────────────────
     Reveal observer
  ─────────────────────────────────────────────── */
  const ioReveals = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        ioReveals.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  function onceInView(el, cb) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          cb();
          io.disconnect();
        }
      });
    }, { threshold: 0.15 });
    io.observe(el);
  }

  function autoReveal() {
    document.querySelectorAll('.rev, .stagger').forEach(el => ioReveals.observe(el));
    document.querySelectorAll('.bar-cell, .geo-row, .funnel-step').forEach(el => {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.2 });
      io.observe(el);
    });
  }

  /* ──────────────────────────────────────────────
     Auto-animate all [data-counter] on load
  ─────────────────────────────────────────────── */
  function autoCounters() {
    document.querySelectorAll('[data-counter]').forEach(el => {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            const target = parseFloat(el.dataset.counter);
            animateCounter(el, target, {
              prefix: el.dataset.prefix || '',
              suffix: el.dataset.suffix || '',
              decimals: parseInt(el.dataset.decimals || '0', 10),
            });
            io.unobserve(el);
          }
        });
      }, { threshold: 0.4 });
      io.observe(el);
    });
  }

  function formatVal(v, unit) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M' + (unit || '');
    if (v >= 1000) return (v / 1000).toFixed(0) + 'k' + (unit || '');
    return Math.round(v) + (unit || '');
  }

  return {
    areaChart, stackedArea, donut, barH, columns, sparkline, gauge,
    animateCounter, autoCounters, autoReveal, tween, ease,
  };
})();
