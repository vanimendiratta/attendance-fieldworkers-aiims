const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
 * Validate and process captured photo from base64 or file upload
 */
function processCapturedPhoto(inputData, destinationSubdir = 'checkins') {
  let buffer;

  if (Buffer.isBuffer(inputData)) {
    buffer = inputData;
  } else if (typeof inputData === 'string') {
    // Handle data URL: e.g. "data:image/jpeg;base64,..."
    const match = inputData.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (match) {
      buffer = Buffer.from(match[2], 'base64');
    } else {
      // Plain base64 string
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

  // Save to disk
  const uploadDir = path.join(__dirname, `../../uploads/${destinationSubdir}`);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const filename = `${destinationSubdir}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${headerCheck.ext}`;
  const fullPath = path.join(uploadDir, filename);
  const relativePath = `/uploads/${destinationSubdir}/${filename}`;

  fs.writeFileSync(fullPath, buffer);

  return {
    filename,
    relativePath,
    fullPath,
    fileSize: buffer.length,
    mimeType: headerCheck.mime,
    hash
  };
}

module.exports = {
  processCapturedPhoto,
  inspectImageBuffer
};
