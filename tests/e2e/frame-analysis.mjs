// Análise dos quadros que o navegador de fato apresentou (captura de tela do Chromium). Funções puras: não usam navegador nem rede,
// por isso têm testes próprios (tests/frame-analysis.test.mjs) com quadros sintéticos — é assim que se sabe que a análise enxerga
// uma tela preta, um "mergulho no preto" ou um efeito trocado por outro, e não apenas que "passou".
//
// Um quadro amostrado (`sample`) é:
//   { t, centro, esquerda, direita, cantoSE, cantoID,   cores [r,g,b] de pontos fixos da tela
//     cells,                                            48 cores médias ao longo de uma linha horizontal da tela
//     sharp,                                            variação média entre pixels vizinhos (luminância) na metade central da linha
//     blankRun }                                        maior trecho contínuo, em pixels, com a cor do fundo do palco

export const STAGE_BACKGROUND = Object.freeze([8, 9, 11]);

export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
export const isNear = (color, target, tolerance = 36) => distance(color, target) <= tolerance;
// Tela "vazia": a cor do fundo do palco, o que apareceria se nenhuma camada cobrisse o quadro.
export const isBlank = color => distance(color, STAGE_BACKGROUND) <= 16;
export const mixColor = (a, b, amount) => a.map((value, index) => Math.round(value + (b[index] - value) * amount));

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

// Intervalo típico entre quadros (s), para dar a um período o "tamanho" de pelo menos um quadro.
export const frameInterval = samples => median(samples.slice(1).map((sample, index) => sample.t - samples[index].t).filter(value => value > 0 && value < 0.2)) || 1 / 60;

// ---- tela vazia -----------------------------------------------------------------------------------------------------------------------
// Quadros em que a tela mostra o fundo do palco: algum ponto fixo vazio, ou um trecho largo da linha varrida na cor do fundo
// (uma faixa vazia entre duas camadas que deslizam). `minRun`: largura mínima, em pixels, para contar como faixa.
export function blankFrames(samples, { minRun = 6, points = ['centro', 'esquerda', 'direita', 'cantoSE', 'cantoID'] } = {}) {
  return samples.filter(sample => points.some(name => sample[name] && isBlank(sample[name])) || (sample.blankRun ?? 0) >= minRun);
}

// Só os quadros de um período [from, to] (segundos do relógio da captura).
export const within = (samples, from, to) => samples.filter(sample => sample.t >= from && sample.t <= to);

// ---- linha do tempo: qual conteúdo está na tela, e quando troca ---------------------------------------------------------------------------
// Cada quadro vira o nome de uma cor da paleta quando ao menos `share` das células da linha (ou o ponto central, se não há linha) está
// perto dessa cor; senão é `null` (quadro de transição, ou lixo).
export function labelFrames(samples, palette, { tolerance = 36, share = 0.9 } = {}) {
  const entries = Object.entries(palette);
  return samples.map(sample => {
    if (Array.isArray(sample.cells) && sample.cells.length) {
      for (const [name, color] of entries) {
        const near = sample.cells.filter(cell => isNear(cell, color, tolerance)).length;
        if (near / sample.cells.length >= share) return name;
      }
      return null;
    }
    return entries.find(([, color]) => isNear(sample.centro, color, tolerance))?.[0] ?? null;
  });
}

// Trechos de conteúdo estável e as transições entre eles.
//   runs ........ [{ name, firstIndex, lastIndex, from, to, frames }]   (from/to: tempo do primeiro/último quadro estável)
//   transitions . [{ from, to, frames, start, end, ms }]                 `frames` são os quadros entre dois conteúdos (vazio no corte seco)
//   dwellMs ..... por conteúdo: do início da entrada dele até o início da entrada do próximo (só onde as duas pontas são conhecidas)
//   stray ....... quadros de uma cor da paleta fora de lugar (menos de `minFrames` seguidos): lixo ou piscada
export function timeline(samples, palette, { tolerance = 36, share = 0.9, minFrames = 3 } = {}) {
  const labels = labelFrames(samples, palette, { tolerance, share });
  const raw = [];
  labels.forEach((name, index) => {
    if (!name) return;
    const last = raw.at(-1);
    if (last && last.name === name) { last.lastIndex = index; last.frames++; } else raw.push({ name, firstIndex: index, lastIndex: index, frames: 1 });
  });
  const stray = [];
  const kept = [];
  for (const run of raw) {
    if (run.frames < minFrames) { for (let index = run.firstIndex; index <= run.lastIndex; index++) if (labels[index]) stray.push(index); continue; }
    const last = kept.at(-1);
    if (last && last.name === run.name) { last.lastIndex = run.lastIndex; last.frames += run.frames; } else kept.push({ ...run });
  }
  const runs = kept.map(run => ({ ...run, from: samples[run.firstIndex].t, to: samples[run.lastIndex].t }));
  const transitions = runs.slice(1).map((next, position) => {
    const previous = runs[position];
    const frames = samples.slice(previous.lastIndex + 1, next.firstIndex);
    const start = frames.length ? frames[0].t : next.from;
    return { from: previous.name, to: next.name, frames, start, end: next.from, ms: Math.round((next.from - start) * 1000) };
  });
  // O início da entrada do conteúdo i é o início da transição i-1 → i (no corte seco, o primeiro quadro estável dele).
  const entryStart = runs.map((run, index) => (index === 0 ? null : transitions[index - 1].start));
  const dwellMs = runs.map((run, index) => (entryStart[index] === null || index + 1 >= runs.length ? null : Math.round((entryStart[index + 1] - entryStart[index]) * 1000)));
  return { runs, transitions, dwellMs, stray, labels };
}

// ---- como foi a troca (assinatura de cada efeito) ---------------------------------------------------------------------------------------------
const edgeColor = sample => mixColor(sample.cells[0], sample.cells.at(-1), 0.5);
const middleColor = sample => {
  const cells = sample.cells, from = Math.floor(cells.length * 0.375), to = Math.ceil(cells.length * 0.625);
  const part = cells.slice(from, to);
  return [0, 1, 2].map(channel => Math.round(part.reduce((total, cell) => total + cell[channel], 0) / part.length));
};
export const colorOf = (sample, where = 'centro') => {
  if (where === 'centro') return sample.centro;
  if (where === 'borda') return edgeColor(sample);
  if (where === 'meio') return middleColor(sample);
  return sample[where];
};

// Quanto do conteúdo novo (B) já aparece sobre o antigo (A), projetando a cor observada na reta A→B (0 = só A, 1 = só B).
export function progressOf(color, from, to) {
  const span = [0, 1, 2].map(channel => to[channel] - from[channel]);
  const norm = span.reduce((total, value) => total + value * value, 0);
  if (!norm) return 0;
  return [0, 1, 2].reduce((total, channel) => total + (color[channel] - from[channel]) * span[channel], 0) / norm;
}
// Distância (maior diferença de um canal) entre a cor observada e a reta A→B: mistura de verdade fica sobre a reta.
export function offLine(color, from, to) {
  const amount = Math.max(0, Math.min(1, progressOf(color, from, to)));
  return distance(color, mixColor(from, to, amount));
}

// Mistura (esmaecer): A passa a B sobre uma reta, igual em toda a tela, sem passar por tela escura.
export function blendReport(frames, from, to) {
  const centre = frames.map(sample => progressOf(colorOf(sample, 'meio'), from, to));
  const edge = frames.map(sample => progressOf(colorOf(sample, 'borda'), from, to));
  const lag = Math.max(0, ...frames.map((sample, index) => centre[index] - edge[index]));
  const spread = Math.max(0, ...frames.map((sample, index) => Math.abs(centre[index] - edge[index])));
  let backwards = 0;
  for (let index = 1; index < centre.length; index++) backwards = Math.max(backwards, centre[index - 1] - centre[index]);
  return {
    frames: frames.length, progress: centre,
    maxOffLine: Math.max(0, ...frames.map(sample => offLine(colorOf(sample, 'meio'), from, to))),
    minLuminance: frames.length ? Math.min(...frames.map(sample => luminance(colorOf(sample, 'meio')))) : Infinity,
    edgeLag: lag, edgeSpread: spread, backwards
  };
}

const cellsNear = (sample, color, tolerance) => sample.cells.map(cell => isNear(cell, color, tolerance));

// Deslizar: duas cores lado a lado (A à esquerda, B à direita) e a divisa andando da direita para a esquerda; sem mistura.
export function slideReport(frames, from, to, { tolerance = 36 } = {}) {
  const boundaries = [];
  let sideBySide = 0, mixedMax = 0, wrongOrder = 0;
  for (const sample of frames) {
    const a = cellsNear(sample, from, tolerance), b = cellsNear(sample, to, tolerance);
    const countA = a.filter(Boolean).length, countB = b.filter(Boolean).length;
    if (countA >= 8 && countB >= 8) sideBySide++;
    mixedMax = Math.max(mixedMax, sample.cells.length - countA - countB);
    let lead = 0;
    while (lead < a.length && a[lead]) lead++;
    boundaries.push(lead);
    // B nunca fica à esquerda de A.
    const firstB = b.indexOf(true), lastA = a.lastIndexOf(true);
    if (firstB !== -1 && lastA !== -1 && firstB < lastA) wrongOrder++;
  }
  let backwards = 0;
  for (let index = 1; index < boundaries.length; index++) backwards = Math.max(backwards, boundaries[index] - boundaries[index - 1]);
  return { frames: frames.length, sideBySide, boundaries, mixedMax, wrongOrder, backwards, travelled: boundaries.length ? Math.max(...boundaries) - Math.min(...boundaries) : 0 };
}

// Zoom: o conteúdo novo cresce a partir do centro. Enquanto o meio já mostra o novo, as bordas ainda mostram só o antigo.
export function zoomReport(frames, from, to, { centreFrom = 0.3, edgeBelow = 0.08 } = {}) {
  let growing = 0, maxLag = 0;
  const centre = frames.map(sample => progressOf(colorOf(sample, 'meio'), from, to));
  frames.forEach((sample, index) => {
    const edge = progressOf(colorOf(sample, 'borda'), from, to);
    if (centre[index] >= centreFrom && edge <= edgeBelow) growing++;
    maxLag = Math.max(maxLag, centre[index] - edge);
  });
  return { frames: frames.length, growing, maxLag, progress: centre };
}

// Qual efeito os quadros de uma troca (de A para B, ambos de cor lisa) mostram? Um só resultado, decidido por assinaturas que não se
// confundem: deslizar tem as duas cores lado a lado; zoom tem o meio já mostrando o novo enquanto as bordas ainda mostram só o antigo;
// esmaecer mistura igualmente em toda a tela, sobre a reta A→B e sem passar por escuro; corte seco não tem quadro intermediário.
// (Dissolver só se distingue de esmaecer com imagens de listras: ver blurReport.)
export function classifyEffect(frames, from, to) {
  const minimum = Math.min(luminance(from), luminance(to));
  const blend = blendReport(frames, from, to), slide = slideReport(frames, from, to), zoom = zoomReport(frames, from, to);
  const reports = { blend, slide, zoom };
  if (frames.length < 3) return { effect: 'cut', reports };
  if (slide.sideBySide >= 4 && slide.wrongOrder === 0) return { effect: 'slide', reports };
  if (zoom.growing >= 3) return { effect: 'zoom', reports };
  if (blend.minLuminance < minimum - 12) return { effect: 'dip', reports };
  if (blend.maxOffLine <= 20 && blend.edgeSpread <= 0.15) return { effect: 'fade', reports };
  return { effect: 'unknown', reports };
}

// Dissolver: o novo conteúdo surge desfocado. Com listras finas, o desfoque as apaga: a variação entre pixels vizinhos, em relação à
// que o conteúdo tem nítido e à fração dele já visível, fica muito abaixo de 1. No esmaecer (sem desfoque) fica perto de 1.
//   from: cor lisa do conteúdo que sai · mean: cor média das listras · sharpFull: variação do conteúdo novo já nítido na tela
export function blurReport(frames, from, mean, sharpFull) {
  return frames.map(sample => {
    const progress = progressOf(colorOf(sample, 'meio'), from, mean);
    return { progress, norm: progress > 0.05 ? sample.sharp / (progress * sharpFull) : null };
  });
}
