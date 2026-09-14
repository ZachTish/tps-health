/** One scanner owns only the app-level lock it successfully acquired. */
export interface BarcodeOrientationDriver {
  lock(): Promise<void>;
  unlock(): Promise<void>;
}

export function barcodeOrientationDrivers(win: any): BarcodeOrientationDriver[] {
  const drivers: BarcodeOrientationDriver[] = [];
  const native = win.Capacitor?.Plugins?.ScreenOrientation;
  if (typeof native?.lock === "function" && typeof native?.unlock === "function") {
    drivers.push({
      lock: () => native.lock({ orientation: "portrait" }),
      unlock: () => native.unlock(),
    });
  }
  const web = win.screen?.orientation;
  if (typeof web?.lock === "function" && typeof web?.unlock === "function") {
    drivers.push({
      lock: async () => { await web.lock("portrait"); },
      unlock: async () => { await web.unlock(); },
    });
  }
  return drivers;
}

export class BarcodeOrientationLock {
  private active = false;
  private owned: BarcodeOrientationDriver | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private drivers: () => BarcodeOrientationDriver[],
    private report: (result: "locked" | "released" | "unavailable" | "release-failed") => void,
  ) {}

  setActive(active: boolean): Promise<void> {
    this.active = active;
    this.queue = this.queue.then(async () => {
      if (this.active && !this.owned) {
        for (const driver of this.drivers()) {
          if (!this.active) break;
          try {
            await driver.lock();
            this.owned = driver;
            this.report("locked");
            break;
          } catch { /* Try the next supported host API. Never force fullscreen. */ }
        }
        if (this.active && !this.owned) this.report("unavailable");
      }
      // A close/background event may arrive while lock() is pending.
      if (!this.active && this.owned) {
        try {
          await this.owned.unlock();
          this.owned = null;
          this.report("released");
        } catch {
          this.report("release-failed");
        }
      }
    });
    return this.queue;
  }
}
