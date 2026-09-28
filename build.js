const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (fs.existsSync('client/package.json')) {
  console.log('Detected project root. Installing client dependencies and building Vite client...');
  execSync('npm --prefix client install', { stdio: 'inherit' });
  execSync('npm --prefix client run build', { stdio: 'inherit' });
  
  if (fs.existsSync('client/dist')) {
    // Copy client/dist into ./dist
    fs.cpSync('client/dist', 'dist', { recursive: true });
    console.log('Mirrored client/dist to ./dist.');

    // Also provide server entrypoint fallbacks in ./dist so Vercel never complains if treating as server
    if (fs.existsSync('server.js')) {
      fs.copyFileSync('server.js', path.join('dist', 'server.js'));
      fs.copyFileSync('server.js', path.join('dist', 'index.js'));
      fs.copyFileSync('server.js', path.join('dist', 'app.js'));

      const distSrc = path.join('dist', 'src');
      if (!fs.existsSync(distSrc)) {
        fs.mkdirSync(distSrc, { recursive: true });
      }
      fs.copyFileSync('server.js', path.join(distSrc, 'server.js'));
      fs.copyFileSync('server.js', path.join(distSrc, 'index.js'));
      fs.copyFileSync('server.js', path.join(distSrc, 'app.js'));

      console.log('Generated server entrypoints in ./dist and ./dist/src for Vercel compatibility.');
    }
  }
} else {
  console.log('Detected client directory. Building Vite...');
  execSync('npm run build', { stdio: 'inherit' });
}
