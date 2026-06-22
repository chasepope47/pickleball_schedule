// ── Canvas moon renderer ──────────────────────────────────────────────────────

function _drawMoon(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const CSS = 120;
  canvas.width  = CSS * dpr;
  canvas.height = CSS * dpr;
  canvas.style.width  = CSS + 'px';
  canvas.style.height = CSS + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = CSS / 2, cy = CSS / 2, r = CSS * 0.47;

  // ── Clip to sphere ──
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Base surface — lunar highlands
  const base = ctx.createRadialGradient(cx - 13, cy - 15, 0, cx, cy, r);
  base.addColorStop(0.00, '#ede4cc');
  base.addColorStop(0.28, '#d4c7a0');
  base.addColorStop(0.55, '#b8a87c');
  base.addColorStop(0.78, '#9a8860');
  base.addColorStop(1.00, '#6a5438');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CSS, CSS);

  // Subtle surface colour variation
  for (const [sx, sy, sr, col] of [
    [38, 28, 16, 'rgba(200,190,156,0.28)'],
    [66, 44, 13, 'rgba(155,142,106,0.28)'],
    [48, 72, 18, 'rgba(178,166,126,0.24)'],
    [28, 60, 12, 'rgba(145,133,98,0.28)'],
    [74, 66, 14, 'rgba(198,186,150,0.24)'],
  ]) {
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }

  // Mare (dark volcanic plains)
  for (const [mx, my, mrx, mry, rot] of [
    [40, 37, 16, 13, -0.2],   // Mare Imbrium
    [59, 40, 12, 10,  0.1],   // Mare Serenitatis
    [63, 51, 10,  8, -0.15],  // Mare Tranquillitatis
    [48, 57, 14,  7,  0.3],   // Mare Nubium
    [74, 43,  7,  5,  0.0],   // Mare Crisium
    [38, 49,  7,  5,  0.2],   // Mare Humorum
  ]) {
    ctx.save();
    ctx.translate(mx, my); ctx.rotate(rot);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(mrx, mry));
    g.addColorStop(0.0, 'rgba(52,42,28,0.74)');
    g.addColorStop(0.5, 'rgba(56,46,30,0.52)');
    g.addColorStop(0.8, 'rgba(56,46,30,0.22)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.scale(1, mry / mrx);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, mrx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Craters  [x, y, radius, depth]
  for (const [cx2, cy2, cr, dep] of [
    [27, 26, 7.0, 0.78],  // Tycho
    [71, 28, 5.0, 0.68],  // Copernicus
    [41, 75, 4.5, 0.62],
    [77, 63, 4.0, 0.58],
    [22, 52, 3.5, 0.52],
    [59, 80, 3.5, 0.56],
    [80, 38, 3.0, 0.48],
    [33, 83, 3.0, 0.52],
    [18, 74, 2.5, 0.46],
    [54, 20, 2.5, 0.44],
    [81, 54, 2.5, 0.44],
    [64, 86, 2.5, 0.44],
    [85, 23, 2.0, 0.38],
    [14, 62, 2.0, 0.36],
    [62, 66, 2.0, 0.34],
    [44, 18, 2.0, 0.40],
    [86, 76, 2.0, 0.38],
  ]) {
    // Bright outer rim
    const rim = ctx.createRadialGradient(cx2, cy2, cr * 0.55, cx2, cy2, cr * 1.32);
    rim.addColorStop(0,    'rgba(0,0,0,0)');
    rim.addColorStop(0.62, `rgba(208,196,160,${dep*0.44})`);
    rim.addColorStop(0.80, `rgba(224,214,178,${dep*0.56})`);
    rim.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx2, cy2, cr * 1.32, 0, Math.PI * 2); ctx.fill();

    // Dark floor (light from upper-left)
    const floor = ctx.createRadialGradient(cx2+cr*0.2, cy2+cr*0.22, 0, cx2, cy2, cr*0.92);
    floor.addColorStop(0,   `rgba(36,28,16,${dep*0.72})`);
    floor.addColorStop(0.6, `rgba(42,32,18,${dep*0.56})`);
    floor.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = floor;
    ctx.beginPath(); ctx.arc(cx2, cy2, cr * 0.92, 0, Math.PI * 2); ctx.fill();

    // Inner-rim highlight (upper-left catch-light)
    const hi = ctx.createRadialGradient(cx2-cr*0.38, cy2-cr*0.38, 0, cx2, cy2, cr*0.88);
    hi.addColorStop(0,   `rgba(238,228,200,${dep*0.36})`);
    hi.addColorStop(0.4, 'rgba(0,0,0,0)');
    hi.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.arc(cx2, cy2, cr * 0.88, 0, Math.PI * 2); ctx.fill();
  }

  // Terminator shadow (sun from upper-left → shadow on right)
  const term = ctx.createLinearGradient(cx + r*0.22, 0, cx + r, 0);
  term.addColorStop(0,    'rgba(0,0,0,0)');
  term.addColorStop(0.38, 'rgba(0,0,0,0.12)');
  term.addColorStop(0.72, 'rgba(0,0,0,0.62)');
  term.addColorStop(1,    'rgba(0,0,0,0.94)');
  ctx.fillStyle = term;
  ctx.fillRect(0, 0, CSS, CSS);

  ctx.restore();

  // Sphere-edge vignette
  const vig = ctx.createRadialGradient(cx, cy, r*0.52, cx, cy, r);
  vig.addColorStop(0,    'rgba(0,0,0,0)');
  vig.addColorStop(0.70, 'rgba(0,0,0,0.04)');
  vig.addColorStop(0.88, 'rgba(0,0,0,0.32)');
  vig.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = vig; ctx.fill();
  ctx.restore();

  // Warm outer glow
  const glow = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 1.1);
  glow.addColorStop(0, 'rgba(238,218,158,0.10)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
  ctx.fillStyle = glow; ctx.fill();
}

// ── Canvas Earth renderer ─────────────────────────────────────────────────────

function _drawEarth(canvas) {
  const SIZE = 660;
  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width  = SIZE + 'px';
  canvas.style.height = SIZE + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE * 0.46;

  // Map lon/lat → canvas px (Atlantic-centered view, 0°N 30°W at center)
  const px = (lon) => cx + ((lon + 30) / 180) * r;
  const py = (lat) => cy - (lat / 90) * r;

  // ── Clip to sphere ──
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Ocean base
  const ocean = ctx.createRadialGradient(cx - r*0.28, cy - r*0.28, 0, cx, cy, r * 1.1);
  ocean.addColorStop(0.00, '#7ac8f8');
  ocean.addColorStop(0.22, '#4aa4e0');
  ocean.addColorStop(0.48, '#2880cc');
  ocean.addColorStop(0.72, '#1560a8');
  ocean.addColorStop(0.90, '#0a3e80');
  ocean.addColorStop(1.00, '#062060');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle specular glint (upper-left)
  const spec = ctx.createRadialGradient(cx-r*0.42, cy-r*0.42, 0, cx-r*0.3, cy-r*0.3, r*0.52);
  spec.addColorStop(0, 'rgba(255,255,255,0.13)');
  spec.addColorStop(0.4,'rgba(190,228,255,0.06)');
  spec.addColorStop(1,  'rgba(0,0,0,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Land masses ──

  function land(draw, shading) {
    ctx.beginPath(); draw();
    ctx.fillStyle = shading || '#4a8c46'; ctx.fill();
  }

  // North America
  land(() => {
    ctx.moveTo(px(-130), py(60));
    ctx.bezierCurveTo(px(-118),py(68),px(-82),py(72),px(-56),py(66));
    ctx.bezierCurveTo(px(-36), py(62),px(-28),py(54),px(-40),py(47));
    ctx.bezierCurveTo(px(-54), py(43),px(-60),py(36),px(-66),py(26));
    ctx.bezierCurveTo(px(-76), py(16),px(-90),py(10),px(-93),py(18));
    ctx.bezierCurveTo(px(-89), py(28),px(-80),py(32),px(-78),py(38));
    ctx.bezierCurveTo(px(-86), py(42),px(-96),py(48),px(-108),py(52));
    ctx.bezierCurveTo(px(-118),py(55),px(-126),py(56),px(-130),py(60));
  }, '#4e8e48');

  // Western US desert
  land(() => {
    ctx.moveTo(px(-116),py(32));
    ctx.bezierCurveTo(px(-108),py(30),px(-100),py(26),px(-104),py(20));
    ctx.bezierCurveTo(px(-108),py(16),px(-116),py(18),px(-118),py(26));
    ctx.bezierCurveTo(px(-118),py(29),px(-117),py(31),px(-116),py(32));
  }, '#b89050');

  // Greenland
  land(() => {
    ctx.moveTo(px(-50),py(76));
    ctx.bezierCurveTo(px(-28),py(82),px(-16),py(75),px(-20),py(65));
    ctx.bezierCurveTo(px(-30),py(60),px(-46),py(62),px(-54),py(68));
    ctx.bezierCurveTo(px(-52),py(74),px(-50),py(76),px(-50),py(76));
  }, '#ccdae8');

  // Central America
  land(() => {
    ctx.moveTo(px(-88),py(18));
    ctx.bezierCurveTo(px(-84),py(12),px(-80),py(8),px(-76),py(5));
    ctx.bezierCurveTo(px(-74),py(8), px(-76),py(13),px(-80),py(16));
    ctx.closePath();
  }, '#56a050');

  // South America
  land(() => {
    ctx.moveTo(px(-76),py(10));
    ctx.bezierCurveTo(px(-62),py(14),px(-46),py(6), px(-38),py(-2));
    ctx.bezierCurveTo(px(-34),py(-13),px(-36),py(-24),px(-44),py(-32));
    ctx.bezierCurveTo(px(-52),py(-42),px(-56),py(-52),px(-52),py(-56));
    ctx.bezierCurveTo(px(-64),py(-53),px(-68),py(-46),px(-65),py(-38));
    ctx.bezierCurveTo(px(-70),py(-30),px(-76),py(-20),px(-79),py(-8));
    ctx.bezierCurveTo(px(-78),py(4),px(-76),py(10),px(-76),py(10));
  }, '#4e8c44');

  // Amazon basin
  land(() => {
    ctx.moveTo(px(-76),py(6));
    ctx.bezierCurveTo(px(-62),py(8),px(-48),py(2),px(-44),py(-7));
    ctx.bezierCurveTo(px(-52),py(-15),px(-64),py(-11),px(-73),py(-4));
    ctx.closePath();
  }, '#2a6828');

  // Andes
  land(() => {
    ctx.moveTo(px(-79),py(9));
    ctx.bezierCurveTo(px(-77),py(0),px(-77),py(-16),px(-76),py(-30));
    ctx.bezierCurveTo(px(-74),py(-23),px(-73),py(-11),px(-75),py(-1));
    ctx.bezierCurveTo(px(-77),py(6),px(-79),py(9),px(-79),py(9));
  }, '#8a7042');

  // Europe
  land(() => {
    ctx.moveTo(px(-10),py(58));
    ctx.bezierCurveTo(px(6), py(64),px(22),py(60),px(30),py(52));
    ctx.bezierCurveTo(px(34),py(45),px(28),py(39),px(18),py(37));
    ctx.bezierCurveTo(px(7), py(37),px(1), py(42),px(-3),py(44));
    ctx.bezierCurveTo(px(-7),py(41),px(-11),py(36),px(-9),py(32));
    ctx.bezierCurveTo(px(-6),py(28),px(-2),py(26),px(0), py(22));
    ctx.bezierCurveTo(px(-8),py(24),px(-14),py(35),px(-16),py(44));
    ctx.bezierCurveTo(px(-16),py(52),px(-14),py(55),px(-13),py(57));
    ctx.bezierCurveTo(px(-12),py(58),px(-10),py(58),px(-10),py(58));
  }, '#5e9452');

  // Iberian Peninsula
  land(() => {
    ctx.moveTo(px(-10),py(44));
    ctx.bezierCurveTo(px(-4),py(44),px(0),py(38),px(-2),py(33));
    ctx.bezierCurveTo(px(-6),py(30),px(-12),py(33),px(-14),py(38));
    ctx.closePath();
  }, '#6a9a56');

  // Scandinavia
  land(() => {
    ctx.moveTo(px(5), py(58));
    ctx.bezierCurveTo(px(14),py(64),px(22),py(70),px(26),py(68));
    ctx.bezierCurveTo(px(28),py(62),px(22),py(56),px(14),py(54));
    ctx.bezierCurveTo(px(7),py(54),px(5),py(58),px(5),py(58));
  }, '#5a9050');

  // Africa
  land(() => {
    ctx.moveTo(px(-16),py(36));
    ctx.bezierCurveTo(px(-6),py(38),px(12),py(38),px(24),py(34));
    ctx.bezierCurveTo(px(40),py(28),px(52),py(18),px(54),py(8));
    ctx.bezierCurveTo(px(56),py(-2),px(52),py(-16),px(46),py(-28));
    ctx.bezierCurveTo(px(38),py(-40),px(26),py(-48),px(22),py(-38));
    ctx.bezierCurveTo(px(14),py(-22),px(8), py(-10),px(0), py(-5));
    ctx.bezierCurveTo(px(-8),py(0), px(-18),py(6), px(-20),py(14));
    ctx.bezierCurveTo(px(-20),py(24),px(-18),py(30),px(-16),py(36));
  }, '#5a8e48');

  // Sahara
  land(() => {
    ctx.moveTo(px(-14),py(30));
    ctx.bezierCurveTo(px(2), py(32),px(20),py(30),px(30),py(24));
    ctx.bezierCurveTo(px(34),py(18),px(30),py(10),px(22),py(9));
    ctx.bezierCurveTo(px(10),py(9), px(0), py(13),px(-8),py(18));
    ctx.bezierCurveTo(px(-14),py(22),px(-15),py(25),px(-16),py(27));
    ctx.bezierCurveTo(px(-16),py(28),px(-14),py(30),px(-14),py(30));
  }, '#c8a050');

  // Congo / Central Africa rainforest
  land(() => {
    ctx.moveTo(px(10),py(4));
    ctx.bezierCurveTo(px(26),py(8),px(36),py(2),px(34),py(-8));
    ctx.bezierCurveTo(px(28),py(-14),px(14),py(-10),px(6),py(-4));
    ctx.bezierCurveTo(px(7),py(2),px(10),py(4),px(10),py(4));
  }, '#246020');

  // Madagascar
  land(() => {
    ctx.moveTo(px(48),py(-13));
    ctx.bezierCurveTo(px(52),py(-18),px(52),py(-26),px(48),py(-29));
    ctx.bezierCurveTo(px(44),py(-27),px(44),py(-19),px(48),py(-13));
  }, '#5a9448');

  // Middle East / Arabian Peninsula
  land(() => {
    ctx.moveTo(px(32),py(30));
    ctx.bezierCurveTo(px(48),py(28),px(58),py(24),px(60),py(14));
    ctx.bezierCurveTo(px(60),py(4), px(52),py(-2),px(44),py(2));
    ctx.bezierCurveTo(px(36),py(6), px(30),py(14),px(30),py(22));
    ctx.closePath();
  }, '#c0985a');

  // Asia (main body)
  land(() => {
    ctx.moveTo(px(30),py(52));
    ctx.bezierCurveTo(px(50),py(58),px(72),py(62),px(90),py(58));
    ctx.bezierCurveTo(px(118),py(52),px(134),py(44),px(145),py(36));
    ctx.bezierCurveTo(px(150),py(28),px(147),py(18),px(140),py(10));
    ctx.bezierCurveTo(px(132),py(0), px(118),py(-5),px(108),py(-2));
    ctx.bezierCurveTo(px(94),py(2),  px(82),py(4), px(72),py(2));
    ctx.bezierCurveTo(px(60),py(-2), px(52),py(-8),px(48),py(-16));
    ctx.bezierCurveTo(px(40),py(-10),px(38),py(0), px(40),py(8));
    ctx.bezierCurveTo(px(42),py(18), px(38),py(28),px(30),py(32));
    ctx.bezierCurveTo(px(24),py(36), px(20),py(42),px(22),py(48));
    ctx.bezierCurveTo(px(24),py(52), px(27),py(52),px(30),py(52));
  }, '#528a46');

  // Gobi / Central Asia desert
  land(() => {
    ctx.moveTo(px(88),py(44));
    ctx.bezierCurveTo(px(108),py(46),px(118),py(42),px(116),py(34));
    ctx.bezierCurveTo(px(110),py(28),px(94),py(28),px(84),py(32));
    ctx.bezierCurveTo(px(81),py(37),px(84),py(41),px(88),py(44));
  }, '#b89050');

  // Indian subcontinent
  land(() => {
    ctx.moveTo(px(65),py(26));
    ctx.bezierCurveTo(px(80),py(30),px(84),py(24),px(82),py(11));
    ctx.bezierCurveTo(px(80),py(2), px(73),py(-4),px(66),py(2));
    ctx.bezierCurveTo(px(59),py(9), px(59),py(18),px(65),py(26));
  }, '#4e8a42');

  // Japan
  land(() => {
    ctx.moveTo(px(132),py(38));
    ctx.bezierCurveTo(px(140),py(40),px(145),py(35),px(142),py(28));
    ctx.bezierCurveTo(px(139),py(24),px(131),py(27),px(130),py(32));
    ctx.closePath();
  }, '#5a9050');

  // Southeast Asia peninsula
  land(() => {
    ctx.moveTo(px(98),py(22));
    ctx.bezierCurveTo(px(108),py(18),px(108),py(8), px(104),py(0));
    ctx.bezierCurveTo(px(98),py(-4),px(94),py(4), px(96),py(14));
    ctx.closePath();
  }, '#4e8844');

  // Australia
  land(() => {
    ctx.moveTo(px(112),py(-14));
    ctx.bezierCurveTo(px(132),py(-9), px(150),py(-18),px(152),py(-30));
    ctx.bezierCurveTo(px(152),py(-40),px(140),py(-44),px(126),py(-42));
    ctx.bezierCurveTo(px(111),py(-40),px(105),py(-32),px(108),py(-22));
    ctx.bezierCurveTo(px(110),py(-17),px(112),py(-15),px(112),py(-14));
  }, '#8a7e48');

  // Australian east coast (green)
  land(() => {
    ctx.moveTo(px(146),py(-16));
    ctx.bezierCurveTo(px(150),py(-22),px(150),py(-32),px(146),py(-38));
    ctx.bezierCurveTo(px(143),py(-34),px(143),py(-24),px(146),py(-16));
  }, '#5a9048');

  // Antarctica (white cap at bottom)
  const ant = ctx.createRadialGradient(cx, cy+r, 0, cx, cy+r*0.82, r*0.32);
  ant.addColorStop(0,   'rgba(230,240,252,0.96)');
  ant.addColorStop(0.5, 'rgba(215,228,244,0.72)');
  ant.addColorStop(1,   'rgba(200,218,238,0)');
  ctx.fillStyle = ant;
  ctx.fillRect(0, cy+r*0.60, SIZE, r*0.55);

  // Arctic (white cap at top)
  const arc = ctx.createRadialGradient(cx, cy-r, 0, cx, cy-r*0.82, r*0.28);
  arc.addColorStop(0,   'rgba(228,238,250,0.92)');
  arc.addColorStop(0.5, 'rgba(210,224,242,0.62)');
  arc.addColorStop(1,   'rgba(200,218,238,0)');
  ctx.fillStyle = arc;
  ctx.fillRect(0, 0, SIZE, cy-r*0.60);

  // ── Cloud layer ──
  for (const [clx, cly, crx, cry, ca, co] of [
    [px(-38),py(46),  68, 28, -0.40, 0.74],  // North Atlantic storm
    [px(-18),py(52),  56, 22, -0.28, 0.62],
    [px(10), py(58),  50, 18, -0.20, 0.55],
    [px(-60),py(-32), 76, 30,  0.50, 0.60],  // Southern spiral
    [px(-44),py(-40), 62, 24,  0.62, 0.52],
    [px(72), py(-14), 56, 20, -0.18, 0.50],  // Indian Ocean
    [px(12), py(5),   82, 16,  0.10, 0.34],  // Equatorial band
    [px(-28),py(68),  58, 18, -0.22, 0.56],  // Arctic
    [px(-110),py(40), 54, 20,  0.14, 0.46],  // Pacific
    [px(110), py(22), 48, 16,  0.08, 0.42],  // SE Asia
  ]) {
    ctx.save();
    ctx.translate(clx, cly); ctx.rotate(ca);
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(crx, cry));
    cg.addColorStop(0,   `rgba(255,255,255,${co})`);
    cg.addColorStop(0.5, `rgba(246,250,255,${co*0.6})`);
    cg.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.scale(1, cry / crx);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, crx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Terminator shadow (sun upper-right → shadow lower-left)
  const termX = cx - r * 0.12;
  const term = ctx.createLinearGradient(termX - r*0.55, 0, termX, 0);
  term.addColorStop(0,    'rgba(0,0,0,0.90)');
  term.addColorStop(0.55, 'rgba(0,0,0,0.52)');
  term.addColorStop(0.82, 'rgba(0,0,0,0.12)');
  term.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = term;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.restore();

  // Sphere-edge vignette
  const vig = ctx.createRadialGradient(cx, cy, r*0.62, cx, cy, r);
  vig.addColorStop(0,    'rgba(0,0,0,0)');
  vig.addColorStop(0.72, 'rgba(0,0,0,0.04)');
  vig.addColorStop(0.90, 'rgba(0,0,0,0.32)');
  vig.addColorStop(1,    'rgba(0,0,0,0.65)');
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = vig; ctx.fill();
  ctx.restore();

  // Thin blue atmosphere ring
  const atm = ctx.createRadialGradient(cx, cy, r*0.92, cx, cy, r*1.10);
  atm.addColorStop(0,   'rgba(110,185,255,0)');
  atm.addColorStop(0.4, 'rgba(110,185,255,0.24)');
  atm.addColorStop(0.7, 'rgba(80,155,240,0.38)');
  atm.addColorStop(1,   'rgba(50,110,220,0)');
  ctx.beginPath(); ctx.arc(cx, cy, r*1.10, 0, Math.PI * 2);
  ctx.fillStyle = atm; ctx.fill();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initSpaceBackground() {
  const bg = document.getElementById('spaceBg');
  if (!bg) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 320; i++) {
    const s    = document.createElement('div');
    s.className = 'space-star';
    const size = Math.random() * 2.8 + 0.5;
    const dur  = (Math.random() * 4 + 2).toFixed(1);
    const del  = (Math.random() * 6).toFixed(1);
    const glow = (size * 1.2).toFixed(1);
    s.style.cssText =
      `left:${(Math.random()*100).toFixed(2)}%;` +
      `top:${(Math.random()*100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
      `opacity:${(Math.random()*0.7+0.2).toFixed(2)};` +
      `--dur:${dur}s;--delay:${del}s;--glow:${glow}px;`;
    frag.appendChild(s);
  }
  bg.appendChild(frag);
}

export function initLoader() {
  const loader = document.getElementById('appLoader');
  if (!loader || loader.dataset.initialized) return;
  loader.dataset.initialized = '1';

  // Generate loader stars
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 130; i++) {
    const s    = document.createElement('div');
    s.className = 'loader-star';
    const size = Math.random() * 2.4 + 0.4;
    s.style.cssText =
      `left:${(Math.random()*100).toFixed(2)}%;` +
      `top:${(Math.random()*100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
      `--dur:${(Math.random()*2.5+1.5).toFixed(1)}s;` +
      `--delay:${(Math.random()*3).toFixed(1)}s;`;
    frag.appendChild(s);
  }
  loader.appendChild(frag);

  // Draw realistic moon
  const moonCanvas = document.getElementById('moonCanvas');
  if (moonCanvas) _drawMoon(moonCanvas);

  // Earth comes from the background photo — no canvas needed
}

export function showLoader() {
  document.getElementById('appLoader')?.classList.remove('hidden');
}

export function hideLoader() {
  const loader = document.getElementById('appLoader');
  if (loader) loader.classList.add('hidden');
  setTimeout(() => {
    document.getElementById('spaceBg')?.classList.add('photo-visible');
  }, 400);
}
