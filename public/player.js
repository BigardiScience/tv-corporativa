// Player da TV — ponto de entrada. Liga o player (public/js/player/app.js) ao navegador real: documento, rede, relógio e
// armazenamento. A credencial da TV fica somente em localStorage e só é enviada a /api/player/* e /api/media/<id>/file.
import { startPlayer } from './js/player/app.js';

// TV sem armazenamento persistente (ou com ele bloqueado): ler devolve vazio; gravar avisa quem chamou, que decide o que fazer.
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { localStorage.setItem(key, value); },
  remove(key) { try { localStorage.removeItem(key); } catch { /* sem armazenamento */ } }
};

startPlayer({
  doc: document,
  win: window,
  search: location.search,
  navigate: url => { location.assign(url); },
  storage,
  http: (path, init) => fetch(path, init),
  wall: () => Date.now(),
  random: () => Math.random(),
  raf: callback => requestAnimationFrame(callback),
  cancelRaf: id => cancelAnimationFrame(id)
});
