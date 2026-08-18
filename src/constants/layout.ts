/**
 * Layout and UI constants for responsive design and component styling.
 */

/**
 * Minimum width (pixels) to use desktop/table layout instead of mobile/card layout.
 */
export const DESKTOP_MIN_WIDTH = 768;

/**
 * Maximum file size for artifact uploads in bytes.
 * 50 MB limit
 */
export const ARTIFACT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Allowed content types for artifact uploads.
 * Includes images (PNG, JPEG), documents (PDF), and GPS/route files (GPX, CSV).
 */
export const ARTIFACT_ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  'application/gpx+xml',
  'application/gpx',
  'text/csv',
  'application/csv',
] as const;
