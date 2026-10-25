// Dimensiones (metros)
export const WALL_H = 4.4;
export const WALL_T = 0.24;
export const HALL_W = 7;
export const MAIN_W = 9;        // galería principal (eje Z) de la que salen las alas
export const MAIN_ENTRY = 12;   // vestíbulo antes de la primera ala
export const OPEN_H = 3.4;      // altura de la entrada a cada ala
export const WING_START = 1.2;  // distancia de la galería a la primera sala del ala
export const WING_GAP = 1.2;
export const DOOR_W = 3.2;
export const DOOR_H = 3.1;
export const ROOM_GAP = 0.6;
export const MIN_ROOM = 10;
export const MAX_ROOM = 48;
export const WALL_MARGIN = 0.9;

// Huecos en pared para cada tipo de obra
export const IMG = { slot: 3.1, maxW: 2.3, maxH: 1.9, y: 1.8 };
export const VID = { slot: 4.9, maxW: 3.8, maxH: 2.3, y: 2.0 };

// Reparto de carpetas grandes en varias salas
export const MAX_WALL_LENGTH = 150; // las salas grandes se convierten en torres o dobles alturas
export const MAX_AUDIO_PER_ROOM = 9;
export const MAX_ROOMS_PER_WING = 16;
export const WING_OWN_MIN = 4;  // carpetas de 1er nivel con menos salas comparten ala

// Jugador
export const EYE_H = 1.65;
export const PLAYER_R = 0.35;
export const RUN_FACTOR = 2.2;
export const STEP_UP = 0.6;     // desnivel máximo que se sube sin escalera
export const HEAD = 1.85;       // altura de la cabeza sobre los pies (colisiones)

// Arquitectura con desniveles
export const RISE = 0.165;      // contrahuella
export const TREAD = 0.29;      // huella
export const FLOOR_H = 4.6;     // altura de cada piso en las torres
export const MAIN_H = 7;        // altura de la galería principal
export const HALL_LEVEL_STEP = 1.2; // desnivel entre tramos de pasillo

// Rendimiento
// Las distancias de carga, número de videos, resolución, etc. son ajustes del
// usuario: ver src/settings.js (pantalla «Ajustes» dentro de la app).
export const LOAD_CONCURRENCY = 3;
export const BUILD_BUDGET_MS = 6;  // ms por fotograma para construir salas
