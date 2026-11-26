import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { PrintPdfInput, SaveAsInput } from '../shared/ipc';

/** Saves bytes chosen by the user; the path comes from the native dialog, never from the renderer. */
export async function saveAs(owner: BrowserWindow | null, input: SaveAsInput): Promise<{ saved: boolean }> {
  const filters = input.extension === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'CSV', extensions: ['csv'] }];
  const result = await dialog.showSaveDialog(owner ?? BrowserWindow.getFocusedWindow()!, {
    defaultPath: `${input.suggestedName}.${input.extension}`,
    filters,
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await writeFile(result.filePath, Buffer.from(input.dataBase64, 'base64'));
  return { saved: true };
}

/** Renders HTML in an isolated, script-free window and saves the PDF through the native dialog. */
export async function printPdf(owner: BrowserWindow | null, input: PrintPdfInput): Promise<{ saved: boolean }> {
  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true },
  });
  try {
    await hidden.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(input.html, 'utf8').toString('base64')}`);
    const pdf = await hidden.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    return saveAs(owner, { suggestedName: input.suggestedName, extension: 'pdf', dataBase64: pdf.toString('base64') });
  } finally {
    hidden.destroy();
  }
}
