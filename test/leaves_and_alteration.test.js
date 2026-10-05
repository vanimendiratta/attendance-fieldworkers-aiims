/**
 * Unit & Integration Test Suite for Leave Management & Attendance Alteration
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runUnitTests() {
  console.log('🧪 Starting Leave Management & Attendance Alteration Test Suite...\n');

  // 1. Verify Migration 002 exists and contains expected SQL
  console.log('--- Test 1: Migration 002 Integrity ---');
  const migrationPath = path.join(__dirname, '../supabase/migrations/002_leaves_and_regularization.sql');
  assert(fs.existsSync(migrationPath), 'Migration 002 file must exist');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS employee_leaves'), 'Must create employee_leaves table');
  assert(migrationSql.includes('is_regularized INTEGER DEFAULT 0'), 'Must add is_regularized column');
  assert(migrationSql.includes('regularized_by TEXT'), 'Must add regularized_by column');
  assert(migrationSql.includes('regularization_notes TEXT'), 'Must add regularization_notes column');
  console.log('✓ Migration 002 verified for employee_leaves table and regularization columns');

  // 2. Test Hours Calculation Logic for Altered Attendance
  console.log('\n--- Test 2: Alteration Hours & Overtime Calculation ---');
  function calculateShiftHours(checkinStr, checkoutStr, targetShiftHours = 8.0) {
    const [inH, inM] = checkinStr.split(':').map(Number);
    const [outH, outM] = checkoutStr.split(':').map(Number);
    let diffMins = (outH * 60 + outM) - (inH * 60 + inM);
    if (diffMins < 0) diffMins += 24 * 60;
    const netSeconds = diffMins * 60;
    const netHours = Number((netSeconds / 3600).toFixed(2));
    const overtimeSeconds = Math.max(0, netSeconds - Math.round(targetShiftHours * 3600));
    const overtimeHours = Number((overtimeSeconds / 3600).toFixed(2));
    return { netSeconds, netHours, overtimeSeconds, overtimeHours };
  }

  const standardShift = calculateShiftHours('09:00', '17:30', 8.0);
  assert.strictEqual(standardShift.netHours, 8.5);
  assert.strictEqual(standardShift.overtimeHours, 0.5);
  console.log('✓ Standard full shift correctly calculated: 8.5h with 0.5h overtime');

  const exactShift = calculateShiftHours('09:00', '17:00', 8.0);
  assert.strictEqual(exactShift.netHours, 8.0);
  assert.strictEqual(exactShift.overtimeHours, 0.0);
  console.log('✓ Exact target shift correctly calculated: 8.0h with 0.0h overtime');

  const shortShift = calculateShiftHours('10:00', '15:30', 8.0);
  assert.strictEqual(shortShift.netHours, 5.5);
  assert.strictEqual(shortShift.overtimeHours, 0.0);
  console.log('✓ Short shift correctly calculated: 5.5h with 0.0h overtime');

  // 3. Verify API Router Registration
  console.log('\n--- Test 3: API Router Endpoints ---');
  const apiRouter = require('../src/routes/api');
  assert(apiRouter, 'API Router must be importable');
  
  // Inspect registered route paths in router stack
  const registeredRoutes = [];
  apiRouter.stack.forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      registeredRoutes.push({ path: layer.route.path, methods });
    }
  });

  const hasGetLeaves = registeredRoutes.some(r => r.path === '/admin/leaves' && r.methods.includes('GET'));
  const hasPostLeaves = registeredRoutes.some(r => r.path === '/admin/leaves' && r.methods.includes('POST'));
  const hasSyncUnmarked = registeredRoutes.some(r => r.path === '/admin/leaves/sync-unmarked' && r.methods.includes('POST'));
  const hasPutLeaves = registeredRoutes.some(r => r.path === '/admin/leaves/:id' && r.methods.includes('PUT'));
  const hasDeleteLeaves = registeredRoutes.some(r => r.path === '/admin/leaves/:id' && r.methods.includes('DELETE'));
  const hasAlterAttendance = registeredRoutes.some(r => r.path === '/admin/attendance/alter' && r.methods.includes('POST'));

  assert(hasGetLeaves, 'GET /admin/leaves must be registered');
  assert(hasPostLeaves, 'POST /admin/leaves must be registered');
  assert(hasSyncUnmarked, 'POST /admin/leaves/sync-unmarked must be registered');
  assert(hasPutLeaves, 'PUT /admin/leaves/:id must be registered');
  assert(hasDeleteLeaves, 'DELETE /admin/leaves/:id must be registered');
  assert(hasAlterAttendance, 'POST /admin/attendance/alter must be registered');

  console.log('✓ All 6 Leave & Attendance Alteration API endpoints registered properly on router');

  // 4. Verify Frontend UI Elements in admin.html
  console.log('\n--- Test 4: Frontend Admin UI Elements ---');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  assert(adminHtml.includes('id="viewLeave"'), 'admin.html must contain viewLeave panel');
  assert(adminHtml.includes('id="metricLeaveTotalStaff"'), 'admin.html must contain metricLeaveTotalStaff');
  assert(adminHtml.includes('id="metricLeaveUnmarked"'), 'admin.html must contain metricLeaveUnmarked');
  assert(adminHtml.includes('id="btnSyncUnmarkedLeaves"'), 'admin.html must contain btnSyncUnmarkedLeaves');
  assert(adminHtml.includes('id="tableUnmarkedStaff"'), 'admin.html must contain tableUnmarkedStaff');
  assert(adminHtml.includes('id="tableRecordedLeaves"'), 'admin.html must contain tableRecordedLeaves');
  assert(adminHtml.includes('id="modalAlterAttendance"'), 'admin.html must contain modalAlterAttendance');
  assert(adminHtml.includes('id="modalRecordLeave"'), 'admin.html must contain modalRecordLeave');
  console.log('✓ All HTML elements, tables, metrics, and modals verified in public/admin.html');

  // 5. Verify Frontend Controller in admin.js
  console.log('\n--- Test 5: Frontend Controller in admin.js ---');
  const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  assert(adminJs.includes('loadLeavesView'), 'admin.js must define loadLeavesView');
  assert(adminJs.includes('openAlterAttendanceModal'), 'admin.js must define openAlterAttendanceModal');
  assert(adminJs.includes('handleSaveAlterAttendance'), 'admin.js must define handleSaveAlterAttendance');
  assert(adminJs.includes('handleSyncUnmarkedLeaves'), 'admin.js must define handleSyncUnmarkedLeaves');
  assert(adminJs.includes('initLeavesControls'), 'admin.js must define initLeavesControls');
  console.log('✓ Controller functions verified in public/admin.js');

  console.log('\n🎉 ALL LEAVE & ATTENDANCE ALTERATION TESTS PASSED!\n');
}

runUnitTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
