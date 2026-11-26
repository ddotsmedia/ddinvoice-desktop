import { contextBridge } from 'electron';

// Typed minimal API; extended per feature.
contextBridge.exposeInMainWorld('ddi', { version: '0.0.0' });
