import type { Reporter, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
const ids = new Set(Array.from({ length: 100 }, (_, i) => 'owner-' + String(i).padStart(2, '0')));
/** Every ancestor is checked before creation or file access; junctions are never followed. */
export function artifactDirectory(create = false) {
    const cwd = path.resolve(process.cwd()), real = fs.realpathSync(cwd), run = process.env.MODE_OWNER_ARTIFACT_RUN_ID ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(run))
        throw Error('ARTIFACT_RUN_REQUIRED');
    let current = cwd;
    for (const part of ['.cache', 'mode-owner-artifacts', run]) {
        current = path.join(current, part);
        if (!fs.existsSync(current)) {
            if (!create)
                throw Error('ARTIFACT_PATH_MISSING');
            fs.mkdirSync(current);
        }
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory())
            throw Error('ARTIFACT_PATH_UNSAFE');
        const relative = path.relative(real, fs.realpathSync(current));
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
            throw Error('ARTIFACT_PATH_ESCAPE');
    }
    return current;
}
export default class SafeReporter implements Reporter {
    private events: {
        id: string;
        status: string;
        durationMs: number;
    }[] = [];
    private unsafe = false;
    private errors = 0;
    private overflow = false;
    printsToStdio() { return true; }
    onBegin() { const root = artifactDirectory(true); if (fs.readdirSync(root).length)
        throw Error('ARTIFACT_RUN_NOT_FRESH'); }
    onStdOut(chunk: string | Buffer) { this.scan(chunk); }
    onStdErr(chunk: string | Buffer) { this.scan(chunk); }
    private scan(chunk: string | Buffer) { const sentinel = process.env.MODE_OWNER_SECRET_SENTINEL; if (sentinel && chunk.toString().includes(sentinel))
        this.unsafe = true; }
    onError(_error: TestError) { this.errors++; }
    onTestEnd(test: TestCase, result: TestResult) { if (this.events.length >= 100) {
        this.overflow = true;
        return;
    } const id = test.title.match(/^owner-\d{2}(?=\s|$)/)?.[0] ?? 'unclassified'; const safeId = ids.has(id) ? id : 'unclassified'; const status = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status) ? result.status : 'failed'; this.events.push({ id: safeId, status, durationMs: Math.max(0, Math.min(600000, Math.round(result.duration))) }); }
    async onEnd(result: FullResult) {
        const root = artifactDirectory(), approved: string[] = [];
        let count = 0;
        for (const name of fs.readdirSync(root)) {
            if (!/^owner-\d{2}-(320|768|1440)\.png$/.test(name))
                throw Error('UNREVIEWED_ARTIFACT');
            const file = path.join(root, name), stat = fs.lstatSync(file);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 5 * 1024 * 1024 || ++count > 12)
                throw Error('SCREENSHOT_BOUND');
            const header = Buffer.alloc(8), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                fs.readSync(fd, header, 0, 8, 0);
            }
            finally {
                fs.closeSync(fd);
            }
            if (!header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                throw Error('SCREENSHOT_FORMAT');
            approved.push(name);
        }
        const summary = { schemaVersion: 1, status: this.unsafe || this.errors || this.overflow ? 'failed' : result.status, category: this.unsafe ? 'OUTPUT_SENTINEL_DETECTED' : this.overflow ? 'EVENT_BOUND' : this.errors ? 'RUNNER_ERROR' : 'COMPLETE', events: this.events, screenshots: approved };
        const bytes = Buffer.from(JSON.stringify(summary));
        if (bytes.length > 65536)
            throw Error('SUMMARY_BOUND');
        fs.writeFileSync(path.join(root, 'summary.json'), bytes, { flag: 'wx' });
        process.stdout.write(JSON.stringify({ schemaVersion: 1, category: summary.category, status: summary.status, tests: summary.events.length }) + '\n');
        if (this.unsafe || this.errors || this.overflow)
            return { status: 'failed' as const };
    }
}
