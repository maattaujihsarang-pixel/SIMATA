const runAuthTests = require('./test_auth');
const runMasterCrudTests = require('./test_master_crud');
const runStudentAttendanceTests = require('./test_student_attendance');
const runTeacherMultiHourTests = require('./test_teacher_multi_hour');
const runEvidenceStorageTests = require('./test_evidence_storage');
const runSecurityRbacTests = require('./test_security_rbac');
const runPublicAssetsTest = require('./test_public_assets');
const runFrontendMigrationTest = require('./test_frontend_migration');
const runBug30RegressionTests = require('./test_bug30_responder_evidence');

async function runAllTests() {
  console.log('===============================================================');
  console.log('SIMATA PHASE 11: AUTOMATED MASTER VERIFICATION TEST SUITE');
  console.log('===============================================================');

  const results = {
    auth: false,
    master_crud: false,
    student_attendance: false,
    teacher_multi_hour: false,
    evidence_storage: false,
    security_rbac: false,
    public_assets: false,
    frontend_migration: false,
    bug30_evidence: false
  };

  try {
    results.auth = await runAuthTests();
    results.master_crud = await runMasterCrudTests();
    results.student_attendance = await runStudentAttendanceTests();
    results.teacher_multi_hour = await runTeacherMultiHourTests();
    results.evidence_storage = await runEvidenceStorageTests();
    results.security_rbac = await runSecurityRbacTests();
    results.public_assets = await runPublicAssetsTest();
    results.frontend_migration = await runFrontendMigrationTest();
    results.bug30_evidence = await runBug30RegressionTests();

    console.log('\n===============================================================');
    console.log('VERIFICATION SUMMARY');
    console.log('===============================================================');
    let allPassed = true;
    for (const [suite, pass] of Object.entries(results)) {
      const statusStr = pass ? 'PASS (GREEN)' : 'FAIL (RED)';
      if (!pass) allPassed = false;
      console.log(`- ${suite.padEnd(25)}: ${statusStr}`);
    }
    console.log('===============================================================');

    if (allPassed) {
      console.log('OVERALL TEST SUITE STATUS: ALL TESTS PASSED (GREEN)');
      return true;
    } else {
      console.log('OVERALL TEST SUITE STATUS: SOME TESTS FAILED (RED)');
      return false;
    }
  } catch (err) {
    console.error('Fatal error during test suite execution:', err);
    return false;
  }
}

if (require.main === module) {
  runAllTests()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = runAllTests;

