// Preferências guardadas no navegador (somente conveniência por pessoa/computador: nunca dados de negócio nem segredos).
// Todo acesso é protegido: navegação privada ou armazenamento bloqueado não pode quebrar o painel.

export function createPrefs(storage = globalThis.localStorage) {
  const read = (key, fallback = null) => { try { const value = storage?.getItem(key); return value === null || value === undefined ? fallback : value; } catch { return fallback; } };
  const write = (key, value) => { if (!storage) return false; try { storage.setItem(key, String(value)); return true; } catch { return false; } };
  const remove = key => { try { storage?.removeItem(key); } catch { /* sem armazenamento */ } };
  const flag = key => read(key) === 'true';

  return {
    largeText: () => flag('tvcorp-large-text'),
    setLargeText: value => write('tvcorp-large-text', !!value),
    highContrast: () => flag('tvcorp-high-contrast'),
    setHighContrast: value => write('tvcorp-high-contrast', !!value),
    libraryView: () => (read('tvcorp-library-view') === 'list' ? 'list' : 'grid'),
    setLibraryView: value => write('tvcorp-library-view', value === 'list' ? 'list' : 'grid'),
    // Último espaço (unidade + setor) usado por esta pessoa. Só vale se ainda for permitido; quem lê confere.
    space: userId => {
      const [unitId, sectorId] = String(read(`tvcorp-space:${userId}`, '')).split('/');
      return unitId && sectorId ? { unitId, sectorId } : null;
    },
    setSpace: (userId, space) => (space ? write(`tvcorp-space:${userId}`, `${space.unitId}/${space.sectorId}`) : (remove(`tvcorp-space:${userId}`), true)),
    read, write, remove
  };
}
