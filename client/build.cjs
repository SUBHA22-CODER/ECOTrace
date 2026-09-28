const fs = require('fs');
const { execSync } = require('child_process');

if (fs.existsSync('client/package.json')) {
  console.log('Detected project root. Installing client dependencies and running Vite build...');
  execSync('npm --prefix client install', { stdio: 'inherit' });
  execSync('npm --prefix client run build', { stdio: 'inherit' });
  if (fs.existsSync('client/dist')) {
    fs.cpSync('client/dist', 'dist', { recursive: true });
    console.log('Mirrored client/dist to ./dist for Vercel output.');
  }
} else {
  console.log('Detected client directory. Running Vite build directly...');
  execSync('npx vite build', { stdio: 'inherit' });
}
