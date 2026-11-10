/** No synthetic input, grant, or successful action is returned by the production gate. */
export interface DeviceHealth { source: 'unavailable'; authorization: 'privileged_approval_required'; enforcement: 'unavailable'; provenance: string; observedAt: number }
export class NativeDeviceCapabilities {
  health(): DeviceHealth { return {source:'unavailable',authorization:'privileged_approval_required',enforcement:'unavailable',provenance:'OpenHarmony-4.0-Release/API10: usageStatistics @systemapi; target commercial SDK and entitlement unverified',observedAt:Date.now()}; }
  async sample(): Promise<never> { throw Error('No authorized public cross-application usage source'); }
  async restrict(): Promise<never> { throw Error('No approved cross-application restriction API'); }
  async release(): Promise<never> { throw Error('No approved cross-application release API'); }
}
