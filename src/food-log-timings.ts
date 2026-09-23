export interface FoodLogTimingContext {
  route: "tray" | "food";
  platform: "ios" | "android" | "desktop" | "mobile";
  healthVersion: string;
  gcmVersion: string;
  storage: string;
  markdownFiles: number;
  selected: number;
}

type Stage = "save-tray" | "log-food" | "save-remaining-tray" | "food-note"
  | "native-entry" | "daily-note" | "write-entry" | "daily-rollup" | "focus-entry";
type Status = "running" | "finished" | "failed";

interface Timing {
  stage: Stage;
  start: number;
  end?: number;
  status: Status;
}

// Deliberately contains only timings and fixed context, never food names, paths,
// nutrition, settings, errors, or note contents. Nothing is persisted or sent.
export class FoodLogTiming {
  readonly startedAt = new Date().toISOString();
  readonly start: number;
  end?: number;
  status: Status = "running";
  private readonly stages: Timing[] = [];
  private omittedStages = 0;

  constructor(readonly context: FoodLogTimingContext, private readonly now: () => number) {
    this.start = now();
  }

  async measure<T>(stage: Stage, action: () => Promise<T>): Promise<T> {
    const timing: Timing = { stage, start: this.now(), status: "running" };
    if (this.stages.length === 80) {
      this.stages.shift();
      this.omittedStages++;
    }
    this.stages.push(timing);
    try {
      const result = await action();
      timing.status = "finished";
      return result;
    } catch (error) {
      timing.status = "failed";
      this.status = "failed";
      throw error;
    } finally {
      timing.end = this.now();
    }
  }

  snapshot() {
    const now = this.now();
    return {
      ...this.context,
      startedAt: this.startedAt,
      status: this.status,
      durationMs: Math.round((this.end ?? now) - this.start),
      omittedStages: this.omittedStages,
      stages: this.stages.map(timing => ({
        stage: timing.stage,
        status: timing.status,
        offsetMs: Math.round(timing.start - this.start),
        durationMs: Math.round((timing.end ?? now) - timing.start),
      })),
    };
  }
}

export class FoodLogTimings {
  private readonly attempts: FoodLogTiming[] = [];

  constructor(private readonly now = () => performance.now()) {}

  async capture<T>(context: FoodLogTimingContext, action: (timing: FoodLogTiming) => Promise<T>): Promise<T> {
    const timing = new FoodLogTiming(context, this.now);
    this.attempts.push(timing);
    if (this.attempts.length > 8) this.attempts.shift();
    try {
      return await action(timing);
    } catch (error) {
      timing.status = "failed";
      throw error;
    } finally {
      timing.end = this.now();
      if (timing.status === "running") timing.status = "finished";
      // Keep a completed batch even when its individual foods filled the ring.
      const index = this.attempts.indexOf(timing);
      if (index >= 0) this.attempts.splice(index, 1);
      this.attempts.push(timing);
      if (this.attempts.length > 8) this.attempts.shift();
    }
  }

  report(): string | null {
    if (!this.attempts.length) return null;
    return JSON.stringify({
      format: "tps-health-food-log-timings-v1",
      note: "Tray and food timings overlap. Finished means the operation returned, not necessarily that every food was logged. Timings include storage waits and app suspension.",
      attempts: this.attempts.map(timing => timing.snapshot()),
    }, null, 2);
  }
}
