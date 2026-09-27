import { config } from './config';
import { createApp } from './app';
const {app}=await createApp();
await app.listen({port:config.PORT,host:config.HOST});
console.log(`GRAILSHOT game server: http://${config.HOST}:${config.PORT}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
