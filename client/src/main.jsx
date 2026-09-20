import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import '@xyflow/react/dist/style.css';

createRoot(document.getElementById('root')).render(<App />);
