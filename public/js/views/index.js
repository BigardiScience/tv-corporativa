// Mapa de rotas → telas. Cada tela recebe (ctx, rota, contêiner, view) e desenha dentro do contêiner.
import { mountOverview } from './overview.js';
import { mountUnits } from './units.js';
import { mountLibrary } from './library/index.js';
import { mountPlaylists } from './playlists/index.js';
import { mountPlaylistEditor } from './playlists/editor.js';
import { mountSchedules } from './schedules/index.js';
import { mountDisplays } from './displays/index.js';
import { mountUsers } from './users/index.js';
import { mountAudit } from './audit.js';
import { mountSettings } from './settings/index.js';

export const VIEWS = {
  overview: mountOverview,
  units: mountUnits,
  library: mountLibrary,
  playlists: mountPlaylists,
  playlist: mountPlaylistEditor,
  schedules: mountSchedules,
  displays: mountDisplays,
  users: mountUsers,
  audit: mountAudit,
  settings: mountSettings
};
