const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Supported mime types & signature checks
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_IMAGE_SIZE_BYTES = 50; // 50 bytes (allows small test buffers while rejecting empty/truncated)

/**
 * Validate image buffer headers (magic bytes)
 */
function inspectImageBuffer(buffer) {
  if (!buffer || buffer.length < 12) {
    return { valid: false, error: 'Empty or severely truncated image data.' };
  }

  // Check magic bytes
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { valid: true, mime: 'image/png', ext: 'png' };
  }

  // WEBP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { valid: true, mime: 'image/webp', ext: 'webp' };
  }

  return {
    valid: false,
    error: 'Invalid image format. Only real-time captured JPEG, PNG, or WebP images are allowed.'
  };
}

/**
 * Parse and validate image payload in memory without writing to disk.
 * @param {Buffer|string} inputData Base64 string, Data URL, or raw Buffer
 * @returns {{ buffer: Buffer, mimeType: string, ext: string, fileSize: number, hash: string }}
 */
function parseAndValidatePhoto(inputData) {
  let buffer;

  if (Buffer.isBuffer(inputData)) {
    buffer = inputData;
  } else if (typeof inputData === 'string') {
    const match = inputData.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (match) {
      buffer = Buffer.from(match[2], 'base64');
    } else {
      buffer = Buffer.from(inputData, 'base64');
    }
  } else {
    throw new Error('Photo payload is missing or not recognized.');
  }

  // Size constraints
  if (buffer.length < MIN_IMAGE_SIZE_BYTES) {
    throw new Error('Captured photo payload is suspiciously tiny or empty.');
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Captured photo exceeds maximum permitted size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB.`);
  }

  // Magic bytes inspection
  const headerCheck = inspectImageBuffer(buffer);
  if (!headerCheck.valid) {
    throw new Error(headerCheck.error);
  }

  // Compute cryptographic SHA-256 hash for anti-replay & integrity verification
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    fileSize: buffer.length,
    mimeType: headerCheck.mime,
    ext:      headerCheck.ext,
    hash
  };
}

/**
 * Validate and process captured photo from base64 or file upload (local disk)
 */
function processCapturedPhoto(inputData, destinationSubdir = 'checkins') {
  const validated = parseAndValidatePhoto(inputData);
  const { buffer, ext, mimeType, hash } = validated;

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const uploadsRoot  = process.env.UPLOADS_PATH || (isServerless ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, '../../uploads'));
  const uploadDir    = path.join(uploadsRoot, destinationSubdir);
  const filename     = `${destinationSubdir}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const fullPath     = path.join(uploadDir, filename);
  const relativePath = `/uploads/${destinationSubdir}/${filename}`;

  // Attempt local disk write, but never fail or block the request if the filesystem is read-only (e.g. Vercel)
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, buffer);
  } catch (fsErr) {
    console.warn(`[PhotoService] Local disk write skipped or failed (${uploadDir}):`, fsErr.message);
  }

  return {
    filename,
    relativePath,
    fullPath,
    fileSize: buffer.length,
    mimeType,
    hash,
    buffer,
    ext
  };
}

module.exports = {
  parseAndValidatePhoto,
  processCapturedPhoto,
  inspectImageBuffer
};
