import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' agar hasil build bisa di-host di sub-folder mana pun (static hosting).
export default defineConfig({
  base: './',
  plugins: [react()],
});
