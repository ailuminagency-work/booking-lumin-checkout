import type { Reporter, TestCase, TestResult, FullResult, Suite } from '@playwright/test/reporter';
/** Finite evidence only. Never expose titles, exception text, paths or page data. */
export default class SafeFieldBrowserReporter implements Reporter {
  private total=0; private passed=0; private failed=0; private skipped=0; private error=false;
  private cases = new Map<string, number>(); private failedCases: number[] = [];
  onBegin(_config: unknown, suite: Suite) { const tests=suite.allTests(); this.total=tests.length; tests.forEach((test,index)=>this.cases.set(test.id,index+1)); }
  onError() { this.error=true; }
  onTestEnd(test: TestCase, result: TestResult) {
    if(result.status==='passed')this.passed++; else if(result.status==='skipped')this.skipped++;
    else { this.failed++; this.failedCases.push(this.cases.get(test.id) ?? 0); }
  }
  async onEnd(result: FullResult) {
    const passed=result.status==='passed' && !this.error && this.total===12 && this.passed===12 && this.failed===0 && this.skipped===0;
    process.stdout.write(JSON.stringify({schemaVersion:1,kind:'FIELD_BROWSER_V2',status:passed?'passed':'failed',total:this.total,passed:this.passed,failed:this.failed,skipped:this.skipped,failedCases:this.failedCases})+'\n');
    return { status: passed ? 'passed' as const : 'failed' as const };
  }
}
