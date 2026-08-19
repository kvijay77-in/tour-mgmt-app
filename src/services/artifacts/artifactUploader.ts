/**
 * Artifact uploader service — cross-platform file picking and presigned URL upload.
 * Handles native (DocumentPicker) and web (hidden input) file selection.
 * Uploads via presigned S3 URLs without using apiClient (S3 needs raw fetch/FileSystem).
 * See docs/tour-artifacts-handling-design.md §4.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { logger } from '../../utils/logger';

// FileSystemUploadType enum values (re-declared since not exported in main index)
const FileSystemUploadType = {
  BINARY_CONTENT: 0,
  MULTIPART: 1,
} as const;

const TAG = 'ArtifactUploader';

// ============================================================================
// Types
// ============================================================================

/**
 * Picked file with cross-platform metadata.
 * - Web: blob + name
 * - Native: uri + name
 */
export interface PickedFile {
  /** File name with extension */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type (e.g. text/plain, application/gpx+xml) */
  contentType: string;
  /** Native: URI accessible to FileSystem */
  uri?: string;
  /** Web: Blob ready for fetch PUT */
  blob?: Blob;
}

/**
 * Error thrown during file operations.
 */
export class FileError extends Error {
  constructor(
    public code: string,
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'FileError';
  }
}

// ============================================================================
// File picking (platform-specific)
// ============================================================================

/**
 * Pick a file from device/browser storage.
 * 
 * Web: hidden <input type="file"> with MIME type filter.
 * Native: expo-document-picker with type parameter.
 * 
 * @param allowedTypes Array of MIME types (e.g., ['application/gpx+xml', 'text/plain'])
 * @returns PickedFile with uri (native) or blob (web), or null if user cancels
 */
export async function pickArtifactFile(
  allowedTypes: string[],
): Promise<PickedFile | null> {
  if (Platform.OS === 'web') {
    return pickFileWeb(allowedTypes);
  } else {
    return pickFileNative(allowedTypes);
  }
}

/**
 * Web file picker using hidden input element.
 */
async function pickFileWeb(allowedTypes: string[]): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = allowedTypes.join(',');
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        logger.debug(TAG, 'Web file picker cancelled');
        resolve(null);
        return;
      }

      try {
        resolve({
          name: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          blob: file,
        });
      } catch (error) {
        logger.error(TAG, 'Error reading web file', {
          error: error instanceof Error ? error.message : String(error),
        });
        resolve(null);
      }
    });

    input.addEventListener('cancel', () => {
      logger.debug(TAG, 'Web file picker cancelled');
      resolve(null);
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

/**
 * Native file picker using expo-document-picker.
 */
async function pickFileNative(allowedTypes: string[]): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: allowedTypes,
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      logger.debug(TAG, 'Native file picker cancelled');
      return null;
    }

    const asset = result.assets[0];
    if (!asset.uri) {
      throw new FileError('NO_URI', 'DocumentPicker returned asset without uri');
    }

    // Get file size for validation
    let size = asset.size ?? 0;
    if (!size) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri);
        if (info.exists && info.size) {
          size = info.size;
        }
      } catch (error) {
        logger.warn(TAG, 'Could not determine file size', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      name: asset.name || 'unknown',
      size,
      contentType: asset.mimeType || 'application/octet-stream',
      uri: asset.uri,
    };
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
    logger.error(TAG, 'Native file picker error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new FileError(
      'PICKER_ERROR',
      'Failed to pick file',
      error,
    );
  }
}

// ============================================================================
// Upload to presigned URL
// ============================================================================

/**
 * Upload a picked file to a presigned S3 PUT URL.
 * 
 * Web: fetch with PUT, Blob body, Content-Type header.
 * Native: FileSystem.uploadAsync with binary upload.
 * 
 * No Authorization header — S3 presigned URLs reject it.
 * Throws FileError on non-2xx response.
 * 
 * @param uploadUrl Presigned S3 PUT URL from backend
 * @param file PickedFile from pickArtifactFile()
 * @throws FileError on network or HTTP error
 */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: PickedFile,
): Promise<void> {
  logger.debug(TAG, 'Uploading file to presigned URL', {
    fileName: file.name,
    size: file.size,
    contentType: file.contentType,
  });
  if (Platform.OS === 'web') {
    return uploadToPresignedUrlWeb(uploadUrl, file);
  } else {
    return uploadToPresignedUrlNative(uploadUrl, file);
  }
}

/**
 * Web upload using fetch PUT.
 */
async function uploadToPresignedUrlWeb(
  uploadUrl: string,
  file: PickedFile,
): Promise<void> {
  if (!file.blob) {
    throw new FileError('NO_BLOB', 'Web file picker did not provide blob');
  }

  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.contentType,
      },
      body: file.blob,
    });

    if (!response.ok) {
      throw new FileError(
        `HTTP_${response.status}`,
        `S3 upload failed: ${response.status} ${response.statusText}`,
      );
    }

    logger.info(TAG, 'Web upload successful', {
      fileName: file.name,
      size: file.size,
    });
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
    logger.error(TAG, 'Web upload error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new FileError(
      'UPLOAD_ERROR',
      'Failed to upload file to S3',
      error,
    );
  }
}

/**
 * Native upload using FileSystem.uploadAsync.
 */
async function uploadToPresignedUrlNative(
  uploadUrl: string,
  file: PickedFile,
): Promise<void> {
  if (!file.uri) {
    throw new FileError('NO_URI', 'Native file picker did not provide uri');
  }

  try {
    const response = await FileSystem.uploadAsync(uploadUrl, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': file.contentType,
      },
    });

    if (!response || response.status < 200 || response.status >= 300) {
      throw new FileError(
        `HTTP_${response?.status || 'UNKNOWN'}`,
        `S3 upload failed: ${response?.status || 'no response'}`,
      );
    }

    logger.info(TAG, 'Native upload successful', {
      fileName: file.name,
      size: file.size,
      status: response.status,
    });
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }
    logger.error(TAG, 'Native upload error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new FileError(
      'UPLOAD_ERROR',
      'Failed to upload file to S3 - ${file.name}',
      error,
    );
  }
}
