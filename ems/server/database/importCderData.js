// server/database/importCderData.js
const { runMigrations } = require('./migrate');
const { seedMasterPolicies } = require('./seed');
const CderImportService = require('../services/CderImportService');

function runCderImport() {
  console.log('=== Starting CDER Staff & Leave Records Migration ===');
  runMigrations();
  seedMasterPolicies();

  const result = CderImportService.importOfficialCderData();
  console.log('\n--- Employee Import Stats ---');
  console.log(`Total Found in Document : ${result.stats.totalFoundInDoc}`);
  console.log(`Employees Imported      : ${result.stats.employeesImported}`);
  console.log(`Existing Reused         : ${result.stats.employeesExistingReused}`);
  console.log(`Accounts Created        : ${result.stats.accountsCreated}`);
  console.log(`Transactions Created    : ${result.stats.transactionsCreated}`);
  console.log(`Transactions Skipped    : ${result.stats.transactionsSkippedExisting}`);
  
  if (result.stats.duplicatesDetected.length > 0) {
    console.log('\n--- Duplicate Names Detected in Document ---');
    for (const d of result.stats.duplicatesDetected) {
      console.log(`Name "${d.name}" appeared ${d.count} times. Status: ${d.resolution}`);
    }
  }

  console.log('\n--- Balance Reconciliation Summary ---');
  console.log(`Total Leave Balances Audited : ${result.reconciliation.totalRecordsAudited}`);
  console.log(`Matches                      : ${result.reconciliation.matchCount}`);
  console.log(`Mismatches                   : ${result.reconciliation.mismatchCount}`);
  console.log(`Review Required              : ${result.reconciliation.reviewRequiredCount}`);
  console.log(`Fully Reconciled             : ${result.reconciliation.isFullyReconciled ? 'YES' : 'NO'}`);

  return result;
}

if (require.main === module) {
  runCderImport();
}

module.exports = { runCderImport };
