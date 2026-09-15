'use strict';

const assert = require('assert');
const emailService = require('../src/services/email_service');

console.log('Testing Email Backup Service...');

// Test 1: Configuration detector
assert.strictEqual(typeof emailService.isEmailConfigured, 'function');
assert.strictEqual(emailService.isEmailConfigured(), false); // Not set in test env

// Test 2: CSV Generator
const mockRecords = [
  {
    id: 'ATT-TEST-001',
    employee_id: 'EMP-001',
    employee_name: 'Dr. Test Fieldworker',
    department: 'CDER Dental',
    designation: 'Field Researcher',
    email: 'test@aiims.edu',
    employer_name: 'AIIMS',
    team_name: 'Delhi NCR Team',
    state: 'Delhi',
    district: 'New Delhi',
    work_mode: 'FIELD_WORK',
    attendance_status: 'COMPLETED',
    checkin_server_timestamp: '2026-09-15T03:30:00.000Z',
    checkin_lat: 28.5672,
    checkin_lng: 77.2100,
    checkin_accuracy: 12.5,
    checkin_geofence_distance: 25.0,
    checkin_geofence_status: 'WITHIN_GEOFENCE',
    checkin_address: 'AIIMS Campus',
    checkout_server_timestamp: '2026-09-15T11:30:00.000Z',
    checkout_lat: 28.5672,
    checkout_lng: 77.2100,
    checkout_accuracy: 10.0,
    checkout_geofence_distance: 20.0,
    checkout_geofence_status: 'WITHIN_GEOFENCE',
    checkout_address: 'AIIMS Campus',
    gross_working_seconds: 28800,
    break_seconds: 1800,
    net_working_seconds: 27000,
    overtime_seconds: 0,
    field_site_notes: 'Community screening site',
    redcap_sync_status: 'SYNCED',
    created_at: '2026-09-15T03:30:00.000Z'
  }
];

const csv = emailService.generateAttendanceCsv(mockRecords);
assert(csv.startsWith('\uFEFF'), 'CSV must include UTF-8 BOM for Microsoft Excel');
assert(csv.includes('Attendance ID,Employee ID,Employee Name'), 'CSV must include standard header row');
assert(csv.includes('ATT-TEST-001,EMP-001,Dr. Test Fieldworker'), 'CSV must correctly format record cells');
assert(csv.includes('7.50'), 'CSV must calculate net working hours (27000s / 3600 = 7.50h)');

console.log('✓ All Email Backup Service unit tests passed successfully!');
