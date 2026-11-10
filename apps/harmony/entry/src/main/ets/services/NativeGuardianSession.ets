import { GuardianService } from './GuardianCore';
/** Ability lifecycle clears parent authorization and disables foreground practice sampling even if ArkUI page stays mounted. */
export class NativeGuardianSession {
  static current: GuardianService | null = null;
  static background(): void { NativeGuardianSession.current?.lock(); }
}
