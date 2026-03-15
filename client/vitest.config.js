import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/test/**',
        'src/main.jsx',
        'src/KanbanBoard.jsx',
        'src/KanbanCard.jsx',
        'src/KanbanColumn.jsx',
        'src/TaskDetailModal.jsx',
        'src/TerminalDrawer.jsx',
        'src/TerminalPane.jsx',
      ],
    },
  },
});
