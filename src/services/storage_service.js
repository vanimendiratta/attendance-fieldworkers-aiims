/**
 * Supabase Storage Service
 *
 * Handles attendance photo persistence in a private Supabase Storage bucket.
 * Server-side only: never exposes the service-role key to clients.
 *
 * Storage path convention:
 *   attendance/{employer_id}/{employee_id}/{attendance_id}/checkin.{ext}
 *   attendance/{employer_id}/{employee_id}/{attendance_id}/checkout.{ext}
 *
 * Falls back gracefully to local disk in offline/development environments when
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const DEFAULT_BUCKET = 'attendance-photos';
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

function getStorageConfig() {
  const supabaseUrl    = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const bucket         = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

  const isConfigured = Boolean(supabaseUrl && serviceRoleKey);
  return { supabaseUrl, serviceRoleKey, bucket, isConfigured };
}

/**
 * Check if Supabase Storage credentials are present in the environment.
 * @returns {boolean}
 */
function isStorageConfigured() {
  return getStorageConfig().isConfigured;
}

/**
 * Construct safe, normalized storage path for an attendance photo.
 * Ensures no secrets or unescaped characters leak into the path.
 *
 * @param {string} employerId
 * @param {string} employeeId
 * @param {string} attendanceId
 * @param {'checkin'|'checkout'} photoType
 * @param {string} ext
 * @returns {string} e.g. "attendance/ORG-001/EMP-1001/att-xyz/checkin.jpg"
 */
function buildStoragePath(employerId, employeeId, attendanceId, photoType, ext = 'jpg') {
  const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeOrg  = sanitize(employerId || 'default_org');
  const safeEmp  = sanitize(employeeId || 'default_emp');
  const safeAtt  = sanitize(attendanceId || 'default_att');
  const safeType = photoType === 'checkout' ? 'checkout' : 'checkin';
  const safeExt  = (ext || 'jpg').replace(/[^a-zA-Z0-9]/g, '');

  return `attendance/${safeOrg}/${safeEmp}/${safeAtt}/${safeType}.${safeExt}`;
}

/**
 * Upload an attendance photo to Supabase Storage (or local disk in dev).
 *
 * @param {Object} opts
 * @param {Buffer} opts.buffer
 * @param {string} opts.employerId
 * @param {string} opts.employeeId
 * @param {string} opts.attendanceId
 * @param {'checkin'|'checkout'} opts.photoType
 * @param {string} opts.mimeType
 * @param {string} opts.ext
 * @returns {Promise<{ storagePath: string, isRemote: boolean }>}
 */
async function uploadAttendancePhoto({ buffer, employerId, employeeId, attendanceId, photoType, mimeType, ext }) {
  const { supabaseUrl, serviceRoleKey, bucket, isConfigured } = getStorageConfig();

  const storagePath = buildStoragePath(employerId, employeeId, attendanceId, photoType, ext);

  if (!isConfigured) {
    // Local fallback: write to local uploads directory (for offline dev/tests)
    const subDir      = photoType === 'checkout' ? 'checkouts' : 'checkins';
    const uploadsRoot = process.env.UPLOADS_PATH || path.join(__dirname, '../../uploads');
    const targetDir   = path.join(uploadsRoot, subDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const filename  = `${subDir}_${attendanceId}_${Date.now()}.${ext || 'jpg'}`;
    const localPath = path.join(targetDir, filename);
    fs.writeFileSync(localPath, buffer);

    return {
      storagePath: `/uploads/${subDir}/${filename}`,
      fullLocalPath: localPath,
      isRemote: false
    };
  }

  // Upload to private Supabase Storage bucket via REST API
  const uploadEndpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath}`;

  try {
    const response = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':        serviceRoleKey,
        'Content-Type':  mimeType || 'image/jpeg',
        'x-upsert':      'true'
      },
      body: buffer
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'No response body');
      console.error(`[Storage] Upload failed (${response.status}):`, errText);
      throw new Error('Attendance photo storage upload failed.');
    }

    return {
      storagePath,
      isRemote: true
    };
  } catch (err) {
    console.error('[Storage] Network/API error during photo upload:', err.message);
    throw new Error('Failed to upload attendance photo to storage.');
  }
}

/**
 * Generate a short-lived signed URL for a private storage object.
 *
 * @param {string} storagePath
 * @param {number} [expiresIn=3600] Seconds until URL expires
 * @returns {Promise<string|null>} Signed URL or null on failure
 */
async function getSignedPhotoUrl(storagePath, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!storagePath) return null;

  // If path is already a full URL or a local static path, return as is
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://') || storagePath.startsWith('/uploads/')) {
    return storagePath;
  }

  const { supabaseUrl, serviceRoleKey, bucket, isConfigured } = getStorageConfig();

  if (!isConfigured) {
    return storagePath;
  }

  const signEndpoint = `${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${storagePath}`;

  try {
    const response = await fetch(signEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':        serviceRoleKey,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ expiresIn })
    });

    if (!response.ok) {
      console.warn(`[Storage] Failed to generate signed URL (${response.status}) for ${storagePath}`);
      return null;
    }

    const data = await response.json();
    if (data && data.signedURL) {
      // Supabase returns relative signed URL e.g. "/object/sign/..."
      if (data.signedURL.startsWith('http')) {
        return data.signedURL;
      }
      return `${supabaseUrl}/storage/v1${data.signedURL}`;
    }

    return null;
  } catch (err) {
    console.error('[Storage] Error generating signed URL:', err.message);
    return null;
  }
}

/**
 * Delete an object from Supabase Storage (used for cleanup on partial failures).
 *
 * @param {string} storagePath
 * @returns {Promise<boolean>} True if deleted or skipped safely
 */
async function deleteAttendancePhoto(storagePath) {
  if (!storagePath) return true;

  // If local path, attempt unlink
  if (storagePath.startsWith('/uploads/')) {
    try {
      const uploadsRoot = process.env.UPLOADS_PATH || path.join(__dirname, '../../uploads');
      const localFile   = path.join(uploadsRoot, storagePath.replace(/^\/uploads\//, ''));
      if (fs.existsSync(localFile)) {
        fs.unlinkSync(localFile);
      }
      return true;
    } catch {
      return false;
    }
  }

  const { supabaseUrl, serviceRoleKey, bucket, isConfigured } = getStorageConfig();
  if (!isConfigured) return true;

  const deleteEndpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`;

  try {
    const response = await fetch(deleteEndpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey':        serviceRoleKey,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ prefixes: [storagePath] })
    });

    return response.ok;
  } catch (err) {
    console.error('[Storage] Error deleting orphaned photo:', err.message);
    return false;
  }
}

/**
 * Helper to resolve photo references for API responses.
 * Replaces private object storage paths with temporary signed URLs so the frontend
 * can render the photo securely.
 *
 * @param {string} photoRef
 * @returns {Promise<string>} Signed URL, local path, or empty string
 */
async function resolvePhotoUrl(photoRef) {
  if (!photoRef) return '';
  if (photoRef.startsWith('http://') || photoRef.startsWith('https://') || photoRef.startsWith('/uploads/')) {
    return photoRef;
  }
  const signed = await getSignedPhotoUrl(photoRef, SIGNED_URL_TTL_SECONDS);
  return signed || photoRef;
}

module.exports = {
  isStorageConfigured,
  buildStoragePath,
  uploadAttendancePhoto,
  getSignedPhotoUrl,
  deleteAttendancePhoto,
  resolvePhotoUrl
};
