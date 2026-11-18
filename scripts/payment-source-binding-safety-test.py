"""Rejection regressions: nonexistent psql ensures no attempted connection."""
import os, pathlib, subprocess, sys, unittest
SCRIPT = pathlib.Path(__file__).with_name("payment-source-binding-concurrency.py")
class SafetyTests(unittest.TestCase):
    def reject(self, updates, message):
        env = os.environ.copy()
        for k in list(env):
            if k.startswith("PG"):
                env.pop(k)
        env.update(PAYMENT_SOURCE_DISPOSABLE="1", PGHOST="127.0.0.1", PGPORT="55449",
                   PGDATABASE="lumin_source_binding_safety", PGUSER="postgres",
                   PSQL_BIN="this-psql-must-never-be-executed")
        for k,v in updates.items():
            if v is None: env.pop(k,None)
            else: env[k]=v
        p = subprocess.run([sys.executable,str(SCRIPT)],env=env,text=True,capture_output=True,timeout=10)
        self.assertNotEqual(p.returncode,0)
        self.assertIn(message,p.stderr)
        self.assertNotIn("FileNotFoundError",p.stderr)
    def test_invalid_ports(self):
        for port in (None,"","0","65536","999999","-1","+5432"," 5432","5432 ","5.5","abc","５４３２"):
            with self.subTest(port=port):
                self.reject({"PGPORT":port},"Explicit bounded numeric PGPORT required")
    def test_target_guards(self):
        for updates,message in (({"PAYMENT_SOURCE_DISPOSABLE":"0"},"Set PAYMENT_SOURCE_DISPOSABLE"),
                                ({"PGHOST":"example.test"},"Loopback-only"),
                                ({"PGDATABASE":"lumin_test"},"Expected dedicated"),
                                ({"PGDATABASE":"lumin_source_binding_x;drop"},"Expected dedicated"),
                                ({"PGUSER":None},"Explicit disposable")):
            with self.subTest(updates=updates): self.reject(updates,message)
if __name__ == "__main__": unittest.main()
