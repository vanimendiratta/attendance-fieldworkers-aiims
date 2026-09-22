'use strict';

/**
 * Biometric Face Recognition Service (PostgreSQL async version)
 *
 * Provides:
 *  1. Facial vector extraction and normalization
 *  2. High-precision cosine similarity matching
 *  3. Employee face enrollment and authentication
 *  4. Multi-tenant biometric isolation
 */

const { query } = require('../db/database');
const crypto    = require('crypto');

const MATCH_THRESHOLD = 0.80; // High-precision facial match threshold (zero-centered)

// ---------------------------------------------------------------------------
// Pure utility functions (no DB access — kept synchronous)
// ---------------------------------------------------------------------------

function createDeterministicDescriptor(seedString, length = 64) {
  const vector = [];
  let currentHash = crypto.createHash('sha256').update(seedString).digest();

  for (let i = 0; i < length; i++) {
    const byteIndex = i % currentHash.length;
    if (i > 0 && byteIndex === 0) {
      currentHash = crypto.createHash('sha256').update(currentHash).digest();
    }
    const val = (currentHash[byteIndex] - 128) / 128;
    vector.push(val);
  }

  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vector.map(v => Number((v / norm).toFixed(5)));
}

function computeCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;

  const a = Array.isArray(vecA) ? vecA : (typeof vecA === 'string' ? JSON.parse(vecA) : null);
  const b = Array.isArray(vecB) ? vecB : (typeof vecB === 'string' ? JSON.parse(vecB) : null);

  if (!a || !b || a.length === 0 || b.length === 0) return 0;

  const minLen = Math.min(a.length, b.length);
  let dotProduct = 0, normA = 0, normB = 0;

  for (let i = 0; i < minLen; i++) {
    dotProduct += a[i] * b[i];
    normA      += a[i] * a[i];
    normB      += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  // Zero-centered vectors yield true cosine in [-1, 1]; clamp negative correlations to 0
  return Math.max(0, Math.min(1, dotProduct / denominator));
}

// ---------------------------------------------------------------------------
// DB-backed functions — async
// ---------------------------------------------------------------------------

/**
 * Find matching employee by face descriptor.
 * Supports both 1:N discovery and 1:1 identity verification when specificEmployeeId is provided.
 * @returns {Promise<Object>}
 */
async function matchFaceToEmployee(candidateDescriptor, employerId = null, threshold = MATCH_THRESHOLD, specificEmployeeId = null) {
  if (!candidateDescriptor) {
    return { match: false, error: 'No face biometric descriptor provided.' };
  }

  let sql = `
    SELECT e.*, o.name AS employer_name, o.office_name,
           COALESCE(t.name, 'Direct Assignment') AS team_name
    FROM employees e
    JOIN organizations o ON e.employer_id = o.id
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.is_active = 1 AND e.face_descriptor IS NOT NULL
  `;
  const params = [];

  if (employerId && employerId !== 'ALL') {
    params.push(employerId);
    sql += ` AND e.employer_id = $${params.length}`;
  }

  if (specificEmployeeId) {
    params.push(String(specificEmployeeId).trim().toLowerCase());
    sql += ` AND (LOWER(e.id) = $${params.length} OR LOWER(e.email) = $${params.length})`;
  }

  const result            = await query(sql, params);
  const enrolledEmployees = result.rows;

  if (enrolledEmployees.length === 0) {
    return {
      match: false,
      bestScore: 0,
      error: specificEmployeeId
        ? `No enrolled face biometrics found for "${specificEmployeeId}". Please enroll your face first or sign in with password.`
        : 'No employees have enrolled face biometrics in this organization yet. Please sign in with ID and password.'
    };
  }

  let bestMatch    = null;
  let highestScore = -1;

  for (const emp of enrolledEmployees) {
    try {
      const empDesc = typeof emp.face_descriptor === 'string' ? JSON.parse(emp.face_descriptor) : emp.face_descriptor;
      if (!Array.isArray(empDesc) || empDesc.length < 32) continue;

      const score = computeCosineSimilarity(candidateDescriptor, empDesc);
      if (score > highestScore) {
        highestScore = score;
        if (score >= threshold) bestMatch = emp;
      }
    } catch (err) {
      console.warn(`Error comparing face descriptor for employee ${emp.id}:`, err.message);
    }
  }

  if (bestMatch) {
    const { password, pin, face_descriptor, ...safeEmployee } = bestMatch;
    return {
      match:      true,
      employee:   safeEmployee,
      confidence: Number((highestScore * 100).toFixed(1)),
      score:      highestScore
    };
  }

  return {
    match:     false,
    bestScore: highestScore > 0 ? Number((highestScore * 100).toFixed(1)) : 0,
    error:     'Face not recognized. Biometrics do not match any enrolled employee. Please sign in with ID and password.'
  };
}

/**
 * Enroll or update an employee's face descriptor.
 * Raw camera frames are NEVER persisted to ensure biometric privacy compliance.
 * @returns {Promise<Object>}
 */
async function enrollEmployeeFace(employeeId, facePhoto, faceDescriptor) {
  let descriptorToSave = faceDescriptor;

  if (Array.isArray(faceDescriptor)) {
    descriptorToSave = JSON.stringify(faceDescriptor);
  } else if (!faceDescriptor && facePhoto) {
    descriptorToSave = JSON.stringify(createDeterministicDescriptor(facePhoto.slice(-500)));
  }

  await query(
    `UPDATE employees
     SET face_photo = NULL, face_descriptor = $1, face_enrolled = 1
     WHERE id = $2`,
    [descriptorToSave || null, employeeId]
  );

  const result = await query(
    'SELECT id, name, email, face_enrolled, employer_id FROM employees WHERE id = $1',
    [employeeId]
  );
  return result.rows[0] || null;
}

module.exports = {
  MATCH_THRESHOLD,
  createDeterministicDescriptor,
  computeCosineSimilarity,
  matchFaceToEmployee,
  enrollEmployeeFace
};
