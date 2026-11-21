// PM2 en el servidor Plesk (usuario de la suscripción trycompany.es).
// La app escucha solo en 127.0.0.1:3041; Apache (comercial.trygestion.com/.htaccess) hace de proxy con HTTPS.
const path = require('path');
const root = process.env.TRY_COMERCIAL_HOME || path.join(process.env.HOME || '', 'try-comercial');
module.exports = {
  apps: [{
    name: 'try-comercial',
    cwd: path.join(root, 'current'),
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3041 -H 127.0.0.1',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '700M',
    time: true,
  }],
};
