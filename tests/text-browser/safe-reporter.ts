import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
/** Finite evidence only: no test titles, exception text, paths, attachments or page data. */
export default class SafeTextBrowserReporter implements Reporter {
  private passed=0; private failed=0; private skipped=0;
  onTestEnd(_test: TestCase, result: TestResult) {
    if(result.status==='passed')this.passed++;else if(result.status==='skipped')this.skipped++;else this.failed++;
  }
  onEnd(result: FullResult) {
    process.stdout.write(JSON.stringify({schemaVersion:1,kind:'TEXT_BROWSER',status:result.status==='passed'?'passed':'failed',passed:this.passed,failed:this.failed,skipped:this.skipped})+'\n');
  }
}
