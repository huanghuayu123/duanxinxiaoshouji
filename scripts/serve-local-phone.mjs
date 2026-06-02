import { startLocalPhoneServer } from './local-phone-server.mjs';

startLocalPhoneServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
