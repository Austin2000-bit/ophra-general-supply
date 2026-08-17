import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = createInterface({ input, output });
const password = await rl.question('Admin password: ');
rl.close();

if (!password) {
  console.error('Password is required.');
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');

console.log('Add these to apps/web/.env and your frontend hosting env:');
console.log(`VITE_ADMIN_PASSWORD_SALT=${salt}`);
console.log(`VITE_ADMIN_PASSWORD_HASH=${hash}`);
console.log('');
console.log('Add these to the API/backend environment too:');
console.log(`ADMIN_PASSWORD_SALT=${salt}`);
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('ADMIN_SESSION_SECRET=' + randomBytes(32).toString('hex'));
