const { execSync } = require('child_process');
const fs = require('fs');

if (fs.existsSync('client')) {
  console.log('Detected project root. Installing client dependencies and building...');
  execSync('npm --prefix client install', { stdio: 'inherit' });
  execSync('npm --prefix client run build', { stdio: 'inherit' });
  
  // Ensure ./dist exists at root for Vercel
  if (fs.existsSync('client/dist')) {
    fs.cpSync('client/dist', 'dist', { recursive: true });
    console.log('Copied client/dist to ./dist successfully.');
  }
} else {
  console.log('Detected client directory. Building...');
  execSync('npm run build', { stdio: 'inherit' });
}
