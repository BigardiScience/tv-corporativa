import baseline from './001-baseline.mjs';
import organization from './002-organization.mjs';
import library from './003-library.mjs';
import displays from './004-displays.mjs';
import playlistsSchedules from './005-playlists-schedules.mjs';
import users from './006-users.mjs';
import playback from './007-reproducao.mjs';
import sharedDisplays from './008-shared-displays.mjs';

// Ordem cronológica. NUNCA edite uma migração já distribuída: crie uma nova.
export const migrations = [baseline, organization, library, displays, playlistsSchedules, users, playback, sharedDisplays];
export const LATEST_SCHEMA = migrations.at(-1).id;
