import {localPool,seedLocalFixtures} from "./fixtures";
const pool=localPool();try{await seedLocalFixtures(pool);console.log("Synthetic local fixtures seeded; no providers connected");}finally{await pool.end();}
