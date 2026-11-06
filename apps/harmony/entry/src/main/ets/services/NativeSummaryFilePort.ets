import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import util from '@ohos.util';
import { SummaryFilePort } from './NativeSummary';

/** API10 reference implementation; target SDK compilation and device behavior remain unverified. */
export class NativeSummaryFilePort implements SummaryFilePort {
  private opened: fs.File | null = null;
  async choose(): Promise<string[]> {
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = ['beaa-learning-summary.json'];
    return new picker.DocumentViewPicker().save(options);
  }
  async open(uri: string): Promise<number> {
    const file = await fs.open(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    this.opened = file;
    return file.fd;
  }
  encode(text: string): Uint8Array { return new util.TextEncoder().encodeInto(text); }
  write(fd: number, bytes: ArrayBuffer, offset: number): Promise<number> {
    return fs.write(fd, bytes, { offset: offset, length: bytes.byteLength });
  }
  sync(fd: number): Promise<void> { return fs.fsync(fd); }
  async close(fd: number): Promise<void> {
    if (this.opened === null || this.opened.fd !== fd) throw new Error('Unknown summary handle');
    try { await fs.close(fd); } finally { this.opened = null; }
  }
}
