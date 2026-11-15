/** Coordenada en grados con su hemisferio, p. ej. "4.59° S" */
const formatCoord = (value, positive, negative) =>
  `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;

/** Latitud y longitud de una región, p. ej. "4.59° S, 137.44° E" */
export const formatLatLon = ({ latitude, longitude }, separator = ', ') =>
  `${formatCoord(latitude, 'N', 'S')}${separator}${formatCoord(longitude, 'E', 'W')}`;

/** Texto seguro para insertar como HTML (los nombres de los terrenos propios los escribe el usuario) */
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
