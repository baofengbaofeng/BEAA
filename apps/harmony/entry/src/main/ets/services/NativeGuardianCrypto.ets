import cryptoFramework from '@ohos.security.cryptoFramework';
import { GuardianCrypto } from './GuardianCore';
/** API10 has no public createKdf: PBKDF2-HMAC-SHA256, 100000 rounds, 32 byte output.
 * Must benchmark on target device; no weak/faster fallback on failure. */
export class NativeGuardianCrypto implements GuardianCrypto {
  private hex(data: Uint8Array): string { return Array.from(data).map(n => n.toString(16).padStart(2, '0')).join(''); }
  async salt(): Promise<string> { return this.hex((await cryptoFramework.createRandom().generateRandom(32)).data); }
  async token(): Promise<string> { return this.salt(); }
  async derive(pin: string, salt: string): Promise<string> {
    if (!/^\d{6,12}$/.test(pin) || !/^[0-9a-f]{64}$/.test(salt)) throw new Error('Invalid credential input');
    // Pad the short PIN key to SHA256's HMAC block size (standard HMAC equivalence).
    const keyBytes = new Uint8Array(64); for (let i = 0; i < pin.length; i++) keyBytes[i] = pin.charCodeAt(i);
    const key = await cryptoFramework.createSymKeyGenerator('HMAC').convertKey({ data: keyBytes });
    const input = new Uint8Array(36); for (let i = 0; i < 32; i++) input[i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16); input[35] = 1;
    let block = input; const output = new Uint8Array(32);
    for (let round = 0; round < 100000; round++) {
      const mac = cryptoFramework.createMac('SHA256'); await mac.init(key); await mac.update({ data: block }); block = (await mac.doFinal()).data;
      for (let i = 0; i < 32; i++) output[i] ^= block[i];
    }
    keyBytes.fill(0); return this.hex(output);
  }
}
