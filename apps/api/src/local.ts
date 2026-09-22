import { localPool,LOCAL_FIXTURE,localIdentity } from "./fixtures";
import { createFlowRepository } from "./repository";
import { createFlowHttpServer } from "./http";
const pool=localPool();const port=Number(process.env.FLOW_API_PORT??"8787");
if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Invalid local port");
const server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:localIdentity,ownerOrigins:[LOCAL_FIXTURE.ownerOrigin],customerOrigins:[LOCAL_FIXTURE.customerOrigin]});
server.listen(port,"127.0.0.1",()=>console.log(`LOCAL_HARNESS listening on http://127.0.0.1:${port}; no real authentication or providers`));
const stop=()=>{server.close(()=>void pool.end());};process.on("SIGTERM",stop);process.on("SIGINT",stop);
