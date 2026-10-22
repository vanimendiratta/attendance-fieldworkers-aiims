// server/routes/api.js
const express = require('express');
const router = express.Router();

const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { loginRateLimiter } = require('../middleware/rateLimiter');

const authController = require('../controllers/authController');
const employeeController = require('../controllers/employeeController');
const leaveTypeController = require('../controllers/leaveTypeController');
const leaveRuleController = require('../controllers/leaveRuleController');
const leaveRequestController = require('../controllers/leaveRequestController');
const leaveLedgerController = require('../controllers/leaveLedgerController');
const compOffController = require('../controllers/compOffController');
const holidayController = require('../controllers/holidayController');
const weeklyOffController = require('../controllers/weeklyOffController');
const sandwichRuleController = require('../controllers/sandwichRuleController');
const reportController = require('../controllers/reportController');
const auditController = require('../controllers/auditController');
const notificationController = require('../controllers/notificationController');

// --- System Info Route ---
router.get('/system/info', (req, res) => {
  res.json({
    environment: process.env.NODE_ENV || 'development',
    isDevelopment: (process.env.NODE_ENV !== 'production'),
    version: '1.0.0'
  });
});

// --- Auth Routes ---
router.post('/auth/login', loginRateLimiter, authController.login);
router.get('/auth/me', requireAuth, authController.getMe);
router.post('/auth/change-password', requireAuth, authController.changePassword);
router.post('/auth/admin-reset-password', requireAdmin, authController.adminResetPassword);

// --- Employee Master Routes ---
router.get('/employees', requireAdmin, employeeController.getAllEmployees);
router.get('/employees/:id', requireAuth, employeeController.getEmployeeById);
router.get('/employees/:id/field-history', requireAuth, employeeController.getFieldWorkerHistory);
router.post('/employees', requireAdmin, employeeController.createEmployee);
router.put('/employees/:id', requireAdmin, employeeController.updateEmployee);

// --- Leave Types Routes ---
router.get('/leave-types', requireAuth, leaveTypeController.getAllLeaveTypes);
router.post('/leave-types', requireAdmin, leaveTypeController.createLeaveType);
router.put('/leave-types/:id', requireAdmin, leaveTypeController.updateLeaveType);

// --- Leave Rules & Versioning Routes ---
router.get('/leave-rules', requireAdmin, leaveRuleController.getAllRules);
router.get('/leave-rules/:ruleId/versions', requireAdmin, leaveRuleController.getRuleVersions);
router.post('/leave-rules/:ruleId/versions', requireAdmin, leaveRuleController.createRuleVersion);

// --- Leave Requests & Workflow Routes ---
router.post('/leave/calculate', requireAuth, leaveRequestController.calculatePreview);
router.get('/leave/requests', requireAuth, leaveRequestController.getRequests);
router.get('/leave/requests/:id', requireAuth, leaveRequestController.getRequestDetails);
router.post('/leave/requests', requireAuth, leaveRequestController.submitRequest);
router.post('/leave/requests/:id/review', requireAdmin, leaveRequestController.reviewRequest);

// --- Leave Ledger & Balances Routes ---
router.get('/ledger/balances', requireAuth, leaveLedgerController.getBalances);
router.get('/ledger/transactions', requireAuth, leaveLedgerController.getTransactions);
router.post('/ledger/adjust', requireAdmin, leaveLedgerController.manualAdjustment);
router.get('/ledger/schedules', requireAdmin, leaveLedgerController.getSchedules);
router.post('/ledger/schedules/run', requireAdmin, leaveLedgerController.runSchedule);
router.get('/ledger/verify-integrity', requireAdmin, leaveLedgerController.verifyIntegrity);

// --- Comp-Off Routes ---
router.get('/comp-off', requireAuth, compOffController.getRecords);
router.post('/comp-off/claim', requireAuth, compOffController.claimCompOff);
router.post('/comp-off/:id/review', requireAdmin, compOffController.reviewClaim);

// --- Holidays Routes ---
router.get('/holidays', requireAuth, holidayController.getAllHolidays);
router.post('/holidays', requireAdmin, holidayController.createHoliday);
router.delete('/holidays/:id', requireAdmin, holidayController.deleteHoliday);

// --- Weekly Off Routes ---
router.get('/weekly-off', requireAuth, weeklyOffController.getAllWeeklyOffRules);
router.post('/weekly-off', requireAdmin, weeklyOffController.createWeeklyOffRule);

// --- Sandwich Rules Routes ---
router.get('/sandwich-rules', requireAuth, sandwichRuleController.getAllSandwichRules);
router.put('/sandwich-rules/:id', requireAdmin, sandwichRuleController.updateSandwichRule);

// --- Reports Routes ---
router.get('/reports/summary', requireAdmin, reportController.getSummaryMetrics);
router.get('/reports/balance-report', requireAdmin, reportController.getBalanceReport);
router.get('/reports/cder-leave-register', requireAuth, reportController.getCderLeaveRegister);
router.get('/reports/cder-reconciliation', requireAdmin, reportController.getCderReconciliation);

// --- Audit Routes ---
router.get('/audit/logs', requireAdmin, auditController.getAuditLogs);

// --- Notification Routes ---
router.get('/notifications', requireAuth, notificationController.getMyNotifications);
router.post('/notifications/:id/read', requireAuth, notificationController.markRead);
router.post('/notifications/read-all', requireAuth, notificationController.markAllRead);

module.exports = router;
